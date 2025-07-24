// src/models/firmaDesprendible.js
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class FirmaDesprendible extends Model {
    // Método para verificar integridad de la firma
    verificarIntegridad(signatureData) {
      const crypto = require('crypto');
      const hashCalculado = crypto.createHash('sha256').update(signatureData).digest('hex');
      return this.hash_firma === hashCalculado;
    }

    // Método para obtener URL firmada de S3 (si usas AWS SDK)
    async obtenerUrlFirmada(expiresIn = 3600) {
      if (!this.firma_s3_key) return null;
      
      // Aquí integrarías con AWS SDK para generar URL firmada
      // const AWS = require('aws-sdk');
      // const s3 = new AWS.S3();
      // return s3.getSignedUrl('getObject', {
      //   Bucket: process.env.AWS_S3_BUCKET,
      //   Key: this.firma_s3_key,
      //   Expires: expiresIn
      // });
      
      return this.firma_url;
    }
  }

  FirmaDesprendible.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      liquidacion_id: {
        type: DataTypes.UUID,
        allowNull: false,
        validate: {
          notNull: { msg: "El ID de liquidación es obligatorio" },
          notEmpty: { msg: "El ID de liquidación no puede estar vacío" },
        },
      },
      conductor_id: {
        type: DataTypes.UUID,
        allowNull: false,
        validate: {
          notNull: { msg: "El ID del conductor es obligatorio" },
          notEmpty: { msg: "El ID del conductor no puede estar vacío" },
        },
      },
      firma_url: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: {
          notNull: { msg: "La URL de la firma es obligatoria" },
          notEmpty: { msg: "La URL de la firma no puede estar vacía" },
          isUrl: { msg: "Debe ser una URL válida" },
        },
      },
      firma_s3_key: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: {
          notNull: { msg: "La clave S3 de la firma es obligatoria" },
          notEmpty: { msg: "La clave S3 de la firma no puede estar vacía" },
        },
      },
      ip_address: {
        type: DataTypes.INET,
        allowNull: true,
        validate: {
          isIP: { msg: "Debe ser una dirección IP válida" },
        },
      },
      user_agent: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      fecha_firma: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      hash_firma: {
        type: DataTypes.TEXT,
        allowNull: true,
        validate: {
          len: {
            args: [64, 64],
            msg: "El hash debe tener exactamente 64 caracteres (SHA-256)",
          },
        },
      },
      estado: {
        type: DataTypes.ENUM("Activa", "Revocada", "Expirada"),
        allowNull: false,
        defaultValue: "Activa",
      },
      observaciones: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      creado_por_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      actualizado_por_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "FirmaDesprendible",
      tableName: "firmas_desprendibles",
      underscored: true,
      indexes: [
        {
          fields: ["liquidacion_id"],
          name: "idx_firmas_desprendibles_liquidacion_id",
        },
        {
          fields: ["conductor_id"],
          name: "idx_firmas_desprendibles_conductor_id",
        },
        {
          fields: ["fecha_firma"],
          name: "idx_firmas_desprendibles_fecha_firma",
        },
        {
          unique: true,
          fields: ["liquidacion_id", "conductor_id"],
          name: "uk_firmas_desprendibles_liquidacion_conductor",
        },
      ],
      hooks: {
        beforeCreate: (firma, options) => {
          // Registrar creador
          if (options.user) {
            firma.creado_por_id = options.user.id;
          }

          // Generar hash si se proporciona signatureData en options
          if (options.signatureData) {
            const crypto = require('crypto');
            firma.hash_firma = crypto.createHash('sha256')
              .update(options.signatureData)
              .digest('hex');
          }

          // Capturar IP y User-Agent desde la request si están disponibles
          if (options.req) {
            firma.ip_address = options.req.ip || 
              options.req.connection.remoteAddress ||
              options.req.socket.remoteAddress ||
              (options.req.connection.socket ? options.req.connection.socket.remoteAddress : null);
            
            firma.user_agent = options.req.headers['user-agent'];
          }
        },
        beforeUpdate: (firma, options) => {
          // Registrar actualizador
          if (options.user) {
            firma.actualizado_por_id = options.user.id;
          }
        },
      },
    }
  );

  FirmaDesprendible.associate = (models) => {
    // Relación con Liquidacion
    FirmaDesprendible.belongsTo(models.Liquidacion, {
      foreignKey: "liquidacion_id",
      as: "liquidacion",
      onDelete: "CASCADE",
    });

    // Relación con Conductor
    FirmaDesprendible.belongsTo(models.Conductor, {
      foreignKey: "conductor_id",
      as: "conductor",
      onDelete: "CASCADE",
    });

    // Relación con User (creador)
    FirmaDesprendible.belongsTo(models.User, {
      foreignKey: "creado_por_id",
      as: "creadoPor",
    });

    // Relación con User (actualizador)
    FirmaDesprendible.belongsTo(models.User, {
      foreignKey: "actualizado_por_id",
      as: "actualizadoPor",
    });
  };

  return FirmaDesprendible;
};