const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  listId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'List',
    required: true,
    index: true
  },
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    default: 0
  },
  unit: {
    type: String,
    default: ''
  },
  emoji: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  purchased: {
    type: Boolean,
    default: false
  },
  purchasedAt: {
    type: Date,
    default: null
  },
  purchasedBy: {
    type: Number, // telegramId
    default: null
  },
  order: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Индексы
itemSchema.index({ listId: 1, storeId: 1, order: 1 });
itemSchema.index({ listId: 1, purchased: 1 });

// Обновить updatedAt при сохранении
itemSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Статический метод для получения всех товаров списка
itemSchema.statics.findByListId = async function(listId) {
  return this.find({ listId }).sort({ storeId: 1, order: 1 });
};

// Статический метод для получения товаров магазина
itemSchema.statics.findByStoreId = async function(storeId) {
  return this.find({ storeId }).sort({ order: 1 });
};

// Статический метод для создания товара с автоматическим порядком
itemSchema.statics.createWithOrder = async function(itemData) {
  const maxOrderItem = await this.findOne({ storeId: itemData.storeId }).sort({ order: -1 });
  const newOrder = maxOrderItem ? maxOrderItem.order + 1 : 0;

  return this.create({
    ...itemData,
    order: newOrder
  });
};

// Метод для toggle purchased
itemSchema.methods.togglePurchased = async function(telegramId) {
  this.purchased = !this.purchased;
  if (this.purchased) {
    this.purchasedAt = new Date();
    this.purchasedBy = telegramId;
  } else {
    this.purchasedAt = null;
    this.purchasedBy = null;
  }
  return this.save();
};

module.exports = mongoose.model('Item', itemSchema);
