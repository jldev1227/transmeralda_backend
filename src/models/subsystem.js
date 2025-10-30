// src/models/subsystem.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Subsystem extends Model { }

  Subsystem.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      validate: {
        notNull: { msg: 'El nombre es obligatorio' },
        notEmpty: { msg: 'El nombre no puede estar vacío' }
      }
    },
    title: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notNull: { msg: 'El título es obligatorio' },
        notEmpty: { msg: 'El título no puede estar vacío' }
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        notNull: { msg: 'La descripción es obligatoria' },
        notEmpty: { msg: 'La descripción no puede estar vacía' }
      }
    },
    url: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        notNull: { msg: 'La URL es obligatoria' },
        notEmpty: { msg: 'La URL no puede estar vacía' },
        isUrl: { msg: 'Debe ser una URL válida' }
      }
    },
    health_endpoint: {
      type: DataTypes.STRING(100),
      defaultValue: '/',
      allowNull: false
    },
    icon_name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        notNull: { msg: 'El nombre del icono es obligatorio' },
        notEmpty: { msg: 'El nombre del icono no puede estar vacío' }
      }
    },
    color_gradient: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notNull: { msg: 'El color del gradiente es obligatorio' },
        notEmpty: { msg: 'El color del gradiente no puede estar vacío' }
      }
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false
    },
    required_permission: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    required_roles: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: true,
      defaultValue: []
    },
    order_index: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'Subsystem',
    tableName: 'subsystems',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['is_active'],
        name: 'idx_subsystems_active'
      },
      {
        fields: ['order_index'],
        name: 'idx_subsystems_order'
      },
      {
        fields: ['name'],
        name: 'idx_subsystems_name'
      }
    ]
  });

  return Subsystem;
};