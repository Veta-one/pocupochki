const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  listId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'List',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  order: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Составной индекс для сортировки
storeSchema.index({ listId: 1, order: 1 });

// Статический метод для получения магазинов списка
storeSchema.statics.findByListId = async function(listId) {
  return this.find({ listId }).sort({ order: 1 });
};

// Статический метод для создания магазина с автоматическим порядком
storeSchema.statics.createWithOrder = async function(listId, name) {
  const maxOrderStore = await this.findOne({ listId }).sort({ order: -1 });
  const newOrder = maxOrderStore ? maxOrderStore.order + 1 : 0;

  return this.create({
    listId,
    name,
    order: newOrder
  });
};

module.exports = mongoose.model('Store', storeSchema);
