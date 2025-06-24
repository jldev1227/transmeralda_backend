// src/models/vehiculo.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Vehiculo extends Model { }

  Vehiculo.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    placa: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        notNull: { msg: 'La placa es obligatoria' },
        notEmpty: { msg: 'La placa no puede estar vacía' }
      }
    },
    marca: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'La marca es obligatoria' },
        notEmpty: { msg: 'La marca no puede estar vacía' }
      }
    },
    linea: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'La línea es obligatoria' },
        notEmpty: { msg: 'La línea no puede estar vacía' }
      }
    },
    modelo: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El modelo es obligatorio' },
        notEmpty: { msg: 'El modelo no puede estar vacío' }
      }
    },
    color: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        notEmptyIfPresent(value) {
          // Si es una string vacía, la convertimos a null automáticamente
          if (value !== null && value !== undefined && value.trim() === '') {
            this.setDataValue('color', null);
          }
        }
      }
    },
    clase_vehiculo: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'La clase de vehículo es obligatoria' },
        notEmpty: { msg: 'La clase de vehículo no puede estar vacía' }
      }
    },
    tipo_carroceria: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        notEmptyIfPresent(value) {
          if (value !== null && value !== undefined && value.trim() === '') {
            throw new Error('El tipo de carrocería no puede estar vacío si se proporciona');
          }
        }
      }
    },
    combustible: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        notEmptyIfPresent(value) {
          if (value !== null && value !== undefined && value.trim() === '') {
            throw new Error('El tipo de combustible no puede estar vacío si se proporciona');
          }
        }
      }
    },
    numero_motor: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        notEmptyIfPresent(value) {
          if (value !== null && value !== undefined && value.trim() === '') {
            throw new Error('El número de motor no puede estar vacío si se proporciona');
          }
        }
      }
    },
    vin: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        notEmptyIfPresent(value) {
          if (value !== null && value !== undefined && value.trim() === '') {
            throw new Error('El VIN no puede estar vacío si se proporciona');
          }
        }
      }
    },
    numero_serie: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        notEmptyIfPresent(value) {
          if (value !== null && value !== undefined && value.trim() === '') {
            throw new Error('El número de serie no puede estar vacío si se proporciona');
          }
        }
      }
    },
    numero_chasis: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        notEmptyIfPresent(value) {
          if (value !== null && value !== undefined && value.trim() === '') {
            throw new Error('El número de chasis no puede estar vacío si se proporciona');
          }
        }
      }
    },
    propietario_nombre: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        notEmptyIfPresent(value) {
          if (value !== null && value !== undefined && value.trim() === '') {
            throw new Error('El nombre del propietario no puede estar vacío si se proporciona');
          }
        }
      }
    },
    propietario_identificacion: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        notEmptyIfPresent(value) {
          if (value !== null && value !== undefined && value.trim() === '') {
            throw new Error('La identificación del propietario no puede estar vacía si se proporciona');
          }
        }
      }
    },
    kilometraje: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      validate: {
        isInt: { msg: 'El kilometraje debe ser un número entero' }
      }
    },
    estado: {
      type: DataTypes.ENUM('DISPONIBLE', 'SERVICIO', 'MANTENIMIENTO', 'DESVINCULADO'),
      defaultValue: 'DISPONIBLE',
      allowNull: true
    },
    galeria: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: '[]',
      get() {
        const rawValue = this.getDataValue('galeria');
        return JSON.parse(rawValue || '[]');
      },
      set(value) {
        this.setDataValue('galeria', JSON.stringify(value));
      },
      validate: {
        isValidJSON(value) {
          if (value !== null && value !== undefined) {
            try {
              JSON.parse(value);
            } catch (e) {
              throw new Error('El formato de galería debe ser JSON válido');
            }
          }
        }
      }
    },
    fecha_matricula: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        notEmptyIfPresent(value) {
          if (value !== null && value !== undefined && value.trim() === '') {
            throw new Error('La fecha de matrícula no puede estar vacía si se proporciona');
          }
        }
      }
    },
  }, {
    sequelize,
    modelName: 'Vehiculo',
    tableName: 'vehiculos',
    underscored: true,
    timestamps: true
  });

  Vehiculo.associate = (models) => {
    if (models.User) {
      Vehiculo.belongsTo(models.User, {
        foreignKey: 'propietario_id',
        as: 'propietario'
      });

      Vehiculo.belongsTo(models.Conductor, {
        foreignKey: 'conductor_id',
        as: 'conductor'
      });
    }

    if (models.Documento) {
      Vehiculo.hasMany(models.Documento, {
        foreignKey: 'vehiculo_id',
        as: 'documentos'
      });
    }

    if (models.Bonificacion) {
      Vehiculo.hasMany(models.Bonificacion, {
        foreignKey: 'vehiculo_id',
        as: 'bonificaciones'
      });
    }

    if (models.Recargo) {
      Vehiculo.hasMany(models.Recargo, {
        foreignKey: 'vehiculo_id',
        as: 'recargos'
      });
    }

    if (models.Pernote) {
      Vehiculo.hasMany(models.Pernote, {
        foreignKey: 'vehiculo_id',
        as: 'pernotes'
      });
    }

    if (models.Mantenimiento) {
      Vehiculo.hasMany(models.Mantenimiento, {
        foreignKey: 'vehiculo_id',
        as: 'mantenimientos'
      });
    }
  };

  return Vehiculo;
};