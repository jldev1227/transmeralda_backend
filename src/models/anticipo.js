// src/models/anticipo.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Anticipo extends Model {}

  Anticipo.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    valor: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        notNull: { msg: 'El valor es obligatorio' },
        isDecimal: { msg: 'El valor debe ser numérico' }
      },
      get() {
        return parseFloat(this.getDataValue('valor'));
      }
    },
    fecha: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      validate: {
        isDate: { msg: 'La fecha debe ser válida' }
      }
    },
    concepto: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'Anticipo',
    tableName: 'anticipos',
    underscored: true,
    hooks: {
      afterCreate: async (anticipo, options) => {
        // Actualizar el total de anticipos en la liquidación
        if (anticipo.liquidacion_id && options.transaction) {
          const { Liquidacion, Anticipo } = sequelize.models;
          const anticipos = await Anticipo.findAll({
            where: { liquidacion_id: anticipo.liquidacion_id },
            transaction: options.transaction
          });
          
          const totalAnticipos = anticipos.reduce(
            (sum, ant) => sum + parseFloat(ant.valor), 0
          );
          
          await Liquidacion.update(
            { totalAnticipos },
            { 
              where: { id: anticipo.liquidacion_id },
              transaction: options.transaction
            }
          );
        }
      },
      afterDestroy: async (anticipo, options) => {
        // Actualizar el total de anticipos en la liquidación
        if (anticipo.liquidacion_id && options.transaction) {
          const { Liquidacion, Anticipo } = sequelize.models;
          const anticipos = await Anticipo.findAll({
            where: { liquidacion_id: anticipo.liquidacion_id },
            transaction: options.transaction
          });
          
          const totalAnticipos = anticipos.reduce(
            (sum, ant) => sum + parseFloat(ant.valor), 0
          );
          
          await Liquidacion.update(
            { totalAnticipos },
            { 
              where: { id: anticipo.liquidacion_id },
              transaction: options.transaction
            }
          );
        }
      }
    }
  });
  
  Anticipo.associate = (models) => {
    Anticipo.belongsTo(models.Liquidacion, {
      foreignKey: 'liquidacion_id',
      as: 'liquidacion'
    });
    
    Anticipo.belongsTo(models.Conductor, {
      foreignKey: 'conductor_id',
      as: 'conductor'
    });
    
    Anticipo.belongsTo(models.User, {
      foreignKey: 'creado_por_id',
      as: 'creadoPor'
    });
  };
  
  return Anticipo;
};