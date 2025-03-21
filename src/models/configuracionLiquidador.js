// src/models/configuracionLiquidador.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class ConfiguracionLiquidador extends Model {}

  ConfiguracionLiquidador.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    nombre: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El nombre es obligatorio' },
        notEmpty: { msg: 'El nombre no puede estar vacío' }
      }
    },
    valor: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        notNull: { msg: 'El valor es obligatorio' }
      }
    },
    descripcion: {
      type: DataTypes.STRING,
      allowNull: true
    },
    activo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    sequelize,
    modelName: 'ConfiguracionLiquidador',
    tableName: 'configuracion_liquidador',
    underscored: true,
    timestamps: true
  });
  
  ConfiguracionLiquidador.associate = (models) => {
    ConfiguracionLiquidador.belongsTo(models.User, {
      foreignKey: 'creado_por_id',
      as: 'creadoPor'
    });
    
    ConfiguracionLiquidador.belongsTo(models.User, {
      foreignKey: 'actualizado_por_id',
      as: 'actualizadoPor'
    });
  };
  
  return ConfiguracionLiquidador;
};