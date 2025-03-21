// src/models/vehiculo.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Vehiculo extends Model {}

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
      allowNull: false,
      validate: {
        notNull: { msg: 'El color es obligatorio' },
        notEmpty: { msg: 'El color no puede estar vacío' }
      }
    },
    claseVehiculo: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'La clase de vehículo es obligatoria' },
        notEmpty: { msg: 'La clase de vehículo no puede estar vacía' }
      }
    },
    tipoCarroceria: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El tipo de carrocería es obligatorio' },
        notEmpty: { msg: 'El tipo de carrocería no puede estar vacío' }
      }
    },
    combustible: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El tipo de combustible es obligatorio' },
        notEmpty: { msg: 'El tipo de combustible no puede estar vacío' }
      }
    },
    numeroMotor: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El número de motor es obligatorio' },
        notEmpty: { msg: 'El número de motor no puede estar vacío' }
      }
    },
    vin: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El VIN es obligatorio' },
        notEmpty: { msg: 'El VIN no puede estar vacío' }
      }
    },
    numeroSerie: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El número de serie es obligatorio' },
        notEmpty: { msg: 'El número de serie no puede estar vacío' }
      }
    },
    numeroChasis: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El número de chasis es obligatorio' },
        notEmpty: { msg: 'El número de chasis no puede estar vacío' }
      }
    },
    propietarioNombre: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El nombre del propietario es obligatorio' },
        notEmpty: { msg: 'El nombre del propietario no puede estar vacío' }
      }
    },
    propietarioIdentificacion: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'La identificación del propietario es obligatoria' },
        notEmpty: { msg: 'La identificación del propietario no puede estar vacía' }
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
      type: DataTypes.ENUM('DISPONIBLE', 'NO DISPONIBLE', 'MANTENIMIENTO', 'INACTIVO'),
      defaultValue: 'DISPONIBLE',
      allowNull: false
    },
    latitud: {
      type: DataTypes.FLOAT,
      allowNull: true
    },
    longitud: {
      type: DataTypes.FLOAT,
      allowNull: true
    },
    galeria: {
      type: DataTypes.TEXT,
      allowNull: false,
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
          try {
            JSON.parse(value);
          } catch (e) {
            throw new Error('El formato de galería debe ser JSON válido');
          }
        }
      }
    },
    fechaMatricula: {
      type: DataTypes.STRING,
      allowNull: true
    },
    soatVencimiento: {
      type: DataTypes.STRING,
      allowNull: true
    },
    tecnomecanicaVencimiento: {
      type: DataTypes.STRING,
      allowNull: true
    },
    tarjetaDeOperacionVencimiento: {
      type: DataTypes.STRING,
      allowNull: true
    },
    polizaContractualVencimiento: {
      type: DataTypes.STRING,
      allowNull: true
    },
    polizaExtraContractualVencimiento: {
      type: DataTypes.STRING,
      allowNull: true
    },
    polizaTodoRiesgoVencimiento: {
      type: DataTypes.STRING,
      allowNull: true
    }
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
        foreignKey: 'modelo_id',
        constraints: false,
        scope: { modelo_tipo: 'Vehiculo' }
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