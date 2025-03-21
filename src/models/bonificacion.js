// src/models/bonificacion.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Bonificacion extends Model {
    // Método para obtener los valores parseados
    getValuesArray() {
      return this.getDataValue('values');
    }
  }

  Bonificacion.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El nombre es obligatorio' },
        notEmpty: { msg: 'El nombre no puede estar vacío' }
      }
    },
    values: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '[]',
      get() {
        const rawValue = this.getDataValue('values');
        return JSON.parse(rawValue || '[]');
      },
      set(value) {
        this.setDataValue('values', JSON.stringify(value));
      },
      validate: {
        isValidJSON(value) {
          try {
            JSON.parse(value);
          } catch (e) {
            throw new Error('El formato de values debe ser JSON válido');
          }
        }
      }
    },
    value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        notNull: { msg: 'El valor es obligatorio' },
        isDecimal: { msg: 'El valor debe ser numérico' }
      }
    }
  }, {
    sequelize,
    modelName: 'Bonificacion',
    tableName: 'bonificaciones',
    underscored: true,
    hooks: {
      afterCreate: async (bonificacion, options) => {
        // Actualizar el total de bonificaciones en la liquidación
        if (bonificacion.liquidacion_id && options.transaction) {
          const { Liquidacion, Bonificacion } = sequelize.models;
          const bonificaciones = await Bonificacion.findAll({
            where: { liquidacion_id: bonificacion.liquidacion_id },
            transaction: options.transaction
          });
          
          const totalBonificaciones = bonificaciones.reduce(
            (sum, bon) => sum + parseFloat(bon.value), 0
          );
          
          await Liquidacion.update(
            { totalBonificaciones },
            { 
              where: { id: bonificacion.liquidacion_id },
              transaction: options.transaction
            }
          );
        }
      },
      afterDestroy: async (bonificacion, options) => {
        // Actualizar el total de bonificaciones en la liquidación
        if (bonificacion.liquidacion_id && options.transaction) {
          const { Liquidacion, Bonificacion } = sequelize.models;
          const bonificaciones = await Bonificacion.findAll({
            where: { liquidacion_id: bonificacion.liquidacion_id },
            transaction: options.transaction
          });
          
          const totalBonificaciones = bonificaciones.reduce(
            (sum, bon) => sum + parseFloat(bon.value), 0
          );
          
          await Liquidacion.update(
            { totalBonificaciones },
            { 
              where: { id: bonificacion.liquidacion_id },
              transaction: options.transaction
            }
          );
        }
      }
    }
  });
  
  Bonificacion.associate = (models) => {
    Bonificacion.belongsTo(models.Liquidacion, {
      foreignKey: 'liquidacion_id',
      as: 'liquidacion'
    });
    
    Bonificacion.belongsTo(models.Vehiculo, {
      foreignKey: 'vehiculo_id',
      as: 'vehiculo'
    });
    
    Bonificacion.belongsTo(models.User, {
      foreignKey: 'creado_por_id',
      as: 'creadoPor'
    });
  };
  
  return Bonificacion;
};