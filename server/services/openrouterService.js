const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';

/**
 * Построение промпта для обработки голосовой команды
 */
function buildPrompt(currentItems) {
  const itemsList = currentItems
    .filter(item => !item.purchased)
    .map(item => {
      let str = `- ${item.name}`;
      if (item.quantity > 0) str += ` (${item.quantity} ${item.unit || 'шт'})`;
      if (item.notes) str += ` [${item.notes}]`;
      str += ` | магазин: ${item.storeName}`;
      return str;
    })
    .join('\n');

  return `Ты помощник для управления списком покупок. Проанализируй голосовое сообщение пользователя и обнови список покупок.

ТЕКУЩИЙ СПИСОК (некупленные товары):
${itemsList || '(список пуст)'}

ПРАВИЛА:
1. Если товар уже есть в списке и пользователь упоминает его количество - ОБНОВИ количество
2. Если товар уже есть и количество НЕ упомянуто - НЕ МЕНЯЙ его
3. Если товара нет - ДОБАВЬ его с quantity: 0 если количество не указано
4. Если пользователь называет магазин - добавь товары в этот магазин
5. Если магазин не назван - используй "Другое" как название магазина
6. Подбери подходящий эмодзи для каждого товара
7. Если пользователь упоминает особые условия (скидка, цена, сорт) - добавь в notes

ФОРМАТ ОТВЕТА (строго JSON):
\`\`\`json
{
  "stores": [
    {
      "name": "Название магазина",
      "items": [
        {
          "name": "Название товара",
          "quantity": 2,
          "unit": "кг",
          "emoji": "🥛",
          "notes": "заметки если есть"
        }
      ]
    }
  ]
}
\`\`\`

Если не можешь разобрать голосовое сообщение, верни:
\`\`\`json
{"error": "Не удалось распознать команду"}
\`\`\``;
}

/**
 * Обработка голосовой команды через OpenRouter API
 */
async function processVoiceCommand(audioBase64, mimeType, currentItems) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const prompt = buildPrompt(currentItems);

  // Определяем формат аудио (OpenRouter поддерживает: wav, mp3, ogg, flac, m4a)
  // webm с opus кодеком отправляем как ogg
  let audioFormat = 'wav';
  if (mimeType.includes('webm') || mimeType.includes('opus')) audioFormat = 'ogg';
  else if (mimeType.includes('ogg')) audioFormat = 'ogg';
  else if (mimeType.includes('mp3') || mimeType.includes('mpeg')) audioFormat = 'mp3';
  else if (mimeType.includes('mp4') || mimeType.includes('m4a')) audioFormat = 'm4a';
  else if (mimeType.includes('flac')) audioFormat = 'flac';

  console.log('Audio mimeType:', mimeType, '-> format:', audioFormat);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.WEBAPP_URL || 'https://shop.vetaone.site',
        'X-Title': 'Pocupochki Shopping List'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'input_audio',
                input_audio: {
                  data: audioBase64,
                  format: audioFormat
                }
              }
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', response.status, errorText);
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    console.log('OpenRouter raw response:', content);

    if (!content) {
      throw new Error('Empty response from OpenRouter');
    }

    // Извлекаем JSON из ответа
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }

    // Пробуем найти JSON объект в тексте
    const jsonObjectMatch = content.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      try {
        return JSON.parse(jsonObjectMatch[0]);
      } catch (e) {
        console.error('Failed to parse JSON object:', e);
      }
    }

    // Пробуем парсить весь ответ как JSON
    try {
      return JSON.parse(content);
    } catch {
      throw new Error('Could not parse response as JSON: ' + content.substring(0, 200));
    }

  } catch (error) {
    console.error('Voice command processing error:', error);
    throw error;
  }
}

/**
 * Простая обработка текстовой команды (без аудио)
 */
async function processTextCommand(text, currentItems) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const prompt = buildPrompt(currentItems);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.WEBAPP_URL || 'https://shop.vetaone.site',
        'X-Title': 'Pocupochki Shopping List'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: prompt
          },
          {
            role: 'user',
            content: text
          }
        ],
        max_tokens: 2000,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', response.status, errorText);
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Empty response from OpenRouter');
    }

    // Извлекаем JSON из ответа
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      try {
        return JSON.parse(content);
      } catch {
        throw new Error('Could not parse response as JSON');
      }
    }

    return JSON.parse(jsonMatch[1]);

  } catch (error) {
    console.error('Text command processing error:', error);
    throw error;
  }
}

/**
 * Обработка изображения (список, скриншот товаров и т.д.)
 */
async function processImageCommand(imageBase64, mimeType, currentItems) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const itemsList = currentItems
    .filter(item => !item.purchased)
    .map(item => `- ${item.name}`)
    .join('\n');

  const imagePrompt = `Ты помощник для управления списком покупок. Проанализируй изображение и извлеки из него товары для добавления в список покупок.

ТЕКУЩИЙ СПИСОК:
${itemsList || '(список пуст)'}

ПРАВИЛА:
1. Извлеки все товары которые видишь на изображении (список покупок, скриншот магазина, чек и т.д.)
2. Если видишь количество товара - укажи его
3. Если видишь цену - можешь добавить её в notes
4. Подбери подходящий эмодзи для каждого товара
5. Если товар уже есть в списке - не дублируй его

ФОРМАТ ОТВЕТА (строго JSON):
\`\`\`json
{
  "stores": [
    {
      "name": "Название магазина или Другое",
      "items": [
        {
          "name": "Название товара",
          "quantity": 2,
          "unit": "кг",
          "emoji": "🥛",
          "notes": "заметки если есть"
        }
      ]
    }
  ]
}
\`\`\`

Если не можешь распознать товары на изображении, верни:
\`\`\`json
{"error": "Не удалось распознать товары на изображении"}
\`\`\``;

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.WEBAPP_URL || 'https://shop.vetaone.site',
        'X-Title': 'Pocupochki Shopping List'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: imagePrompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`
                }
              }
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', response.status, errorText);
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    console.log('Image API response:', content);

    if (!content) {
      throw new Error('Empty response from OpenRouter');
    }

    // Извлекаем JSON из ответа
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }

    // Пробуем найти JSON объект
    const jsonObjectMatch = content.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      try {
        return JSON.parse(jsonObjectMatch[0]);
      } catch (e) {
        console.error('Failed to parse JSON object:', e);
      }
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new Error('Could not parse response as JSON');
    }

  } catch (error) {
    console.error('Image command processing error:', error);
    throw error;
  }
}

module.exports = {
  processVoiceCommand,
  processTextCommand,
  processImageCommand
};
