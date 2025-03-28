// src/models/pernote.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Pernote extends Model {
    // Método para obtener las fechas parseadas
    getFechasArray() {
      return this.getDataValue('fechas');
    }
    
    // Método para calcular el valor total
    getValorTotal() {
      return parseFloat(this.valor) * this.cantidad;
    }
  }

  Pernote.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    empresa_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'empresas',
        key: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    },
    cantidad: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        notNull: { msg: 'La cantidad es obligatoria' },
        isInt: { msg: 'La cantidad debe ser un número entero' },
        min: { args: [1], msg: 'La cantidad debe ser al menos 1' }
      }
    },
    valor: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        notNull: { msg: 'El valor es obligatorio' },
        isDecimal: { msg: 'El valor debe ser numérico' }
      }
    },
    fechas: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '[]',
      get() {
        const rawValue = this.getDataValue('fechas');
        return JSON.parse(rawValue || '[]');
      },
      set(value) {
        this.setDataValue('fechas', JSON.stringify(value));
      },
      validate: {
        isValidJSON(value) {
          try {
            JSON.parse(value);
          } catch (e) {
            throw new Error('El formato de fechas debe ser JSON válido');
          }
        }
      }
    }
  }, {
    sequelize,
    modelName: 'Pernote',
    tableName: 'pernotes',
    underscored: true,
    hooks: {
      afterCreate: async (pernote, options) => {
        // Actualizar el total de pernotes en la liquidación
        if (pernote.liquidacion_id && options.transaction) {
          const { Liquidacion, Pernote } = sequelize.models;
          const pernotes = await Pernote.findAll({
            where: { liquidacion_id: pernote.liquidacion_id },
            transaction: options.transaction
          });
          
          const totalPernotes = pernotes.reduce(
            (sum, per) => sum + (parseFloat(per.valor) * per.cantidad), 0
          );
          
          await Liquidacion.update(
            { totalPernotes },
            { 
              where: { id: pernote.liquidacion_id },
              transaction: options.transaction
            }
          );
        }
      },
      afterDestroy: async (pernote, options) => {
        // Actualizar el total de pernotes en la liquidación
        if (pernote.liquidacion_id && options.transaction) {
          const { Liquidacion, Pernote } = sequelize.models;
          const pernotes = await Pernote.findAll({
            where: { liquidacion_id: pernote.liquidacion_id },
            transaction: options.transaction
          });
          
          const totalPernotes = pernotes.reduce(
            (sum, per) => sum + (parseFloat(per.valor) * per.cantidad), 0
          );
          
          await Liquidacion.update(
            { totalPernotes },
            { 
              where: { id: pernote.liquidacion_id },
              transaction: options.transaction
            }
          );
        }
      }
    }
  });
  
  Pernote.associate = (models) => {
    Pernote.belongsTo(models.Liquidacion, {
      foreignKey: 'liquidacion_id',
      as: 'liquidacion'
    });
    
    Pernote.belongsTo(models.Vehiculo, {
      foreignKey: 'vehiculo_id',
      as: 'vehiculo'
    });

    Pernote.belongsTo(models.Empresa, {
      foreignKey: 'empresa_id',
      as: 'empresa'
    });
    
    Pernote.belongsTo(models.User, {
      foreignKey: 'creado_por_id',
      as: 'creadoPor'
    });
  };
  
  return Pernote;
};