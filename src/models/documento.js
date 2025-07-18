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
      allowNull: true,
      references: {
        model: 'vehiculos',
        key: 'id'
      }
    },
    conductor_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'conductores',
        key: 'id'
      }
    },
    categoria: {
      type: DataTypes.STRING,
      allowNull: false,
      // TARJETA_DE_PROPIEDAD, SEGURO, etc.
    },
    nombre_original: {
      type: DataTypes.STRING,
      allowNull: false
    },
    nombre_archivo: {
      type: DataTypes.STRING,
      allowNull: false
    },
    ruta_archivo: {
      type: DataTypes.STRING,
      allowNull: false
    },
    s3_key: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    filename: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    mimetype: {
      type: DataTypes.STRING,
      allowNull: false
    },
    size: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    fecha_vigencia: {
      type: DataTypes.DATE,
      allowNull: true
    },
    estado: {
      type: DataTypes.ENUM('vigente', 'proximo_a_vencer', 'vencido'),
      allowNull: false,
      defaultValue: 'vigente'
    },
    upload_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    sequelize,
    modelName: 'Documento',
    tableName: 'documento',
    underscored: true,
    timestamps: true,
    hooks: {
      beforeCreate: (documento) => {
        if (documento.fecha_vigencia) {
          const fecha = new Date(documento.fecha_vigencia);
          fecha.setDate(fecha.getDate() + 1);
          documento.fecha_vigencia = fecha;
        }
      },
      beforeUpdate: (documento) => {
        if (documento.fecha_vigencia) {
          const fecha = new Date(documento.fecha_vigencia);
          fecha.setDate(fecha.getDate() + 1);
          documento.fecha_vigencia = fecha;
        }
      }
    }
  });

  Documento.associate = (models) => {
    Documento.belongsTo(models.Vehiculo, {
      foreignKey: 'vehiculo_id',
      as: 'vehiculo'
    });

        // Relación con Conductores (opcional)
    Documento.belongsTo(models.Conductor, {
      foreignKey: 'conductor_id',
      as: 'conductor',
      allowNull: true
    });
  };

  return Documento;
};