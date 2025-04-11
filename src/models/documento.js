// src/models/Documento.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Documento extends Model { }

  Documento.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    vehiculo_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'vehiculos',
        key: 'id'
      }
    },
    document_type: {
      type: DataTypes.STRING,
      allowNull: false,
      // Por ejemplo: 'tarjeta_circulacion', 'seguro', 'verificacion', etc.
    },
    s3_key: {
      type: DataTypes.STRING,
      allowNull: false,
      // Ruta del objeto en S3
    },
    filename: {
      type: DataTypes.STRING,
      allowNull: false
    },
    mimetype: {
      type: DataTypes.STRING,
      allowNull: false
    },
    upload_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
      // Puedes almacenar información adicional como tamaño, usuario que subió, bucket, etc.
    }
  }, {
    sequelize,
    modelName: 'Documento',
    tableName: 'documento',
    underscored: true,
    timestamps: true
  });

  Documento.associate = (models) => {
    Documento.belongsTo(models.Vehiculo, {
      foreignKey: 'vehiculo_id',
      as: 'vehiculo'
    });
  };

  return Documento;
};