// src/models/conductor.js
const { Model, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');

module.exports = (sequelize) => {
  class Conductor extends Model {
    // Método para comparar contraseñas
    async compararPassword(candidatePassword) {
      return await bcrypt.compare(candidatePassword, this.password);
    }
  }

  Conductor.init({
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
    apellido: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El apellido es obligatorio' },
        notEmpty: { msg: 'El apellido no puede estar vacío' }
      }
    },
    tipo_identificacion: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El tipo de identificación es obligatorio' },
        notEmpty: { msg: 'El tipo de identificación no puede estar vacío' }
      }
    },
    numero_identificacion: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        notNull: { msg: 'El número de identificación es obligatorio' },
        notEmpty: { msg: 'El número de identificación no puede estar vacío' }
      }
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,  // Cambiado de false a true
      unique: {
        args: true,
        msg: 'Este correo electrónico ya está registrado en el sistema'
      },
      validate: {
        isEmail: {
          args: true,
          msg: 'Debe proporcionar un correo electrónico válido'
        }
      }
    },
    telefono: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El teléfono es obligatorio' },
        notEmpty: { msg: 'El teléfono no puede estar vacío' }
      }
    },
    password: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        passwordValidation(value) {
          // Solo validar si se proporciona una contraseña
          if (value !== null && value !== undefined && value !== '') {
            if (value.length < 8 || value.length > 16) {
              throw new Error('La contraseña debe tener entre 8 y 16 caracteres');
            }
          }
        }
      }
    },
    fotoUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isUrl: {
          msg: 'La URL de la foto debe ser una dirección web válida'
        }
      }
    },
    fecha_nacimiento: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    genero: {
      type: DataTypes.STRING,
      allowNull: true
    },
    direccion: {
      type: DataTypes.STRING,
      allowNull: true
    },
    cargo: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'CONDUCTOR',
      validate: {
        notNull: { msg: 'El cargo es obligatorio' },
        notEmpty: { msg: 'El cargo no puede estar vacío' }
      }
    },
    fecha_ingreso: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      validate: {
        notNull: { msg: 'La fecha de ingreso es obligatoria' },
        isDate: { msg: 'La fecha de ingreso debe ser válida' }
      }
    },
    salario_base: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        notNull: { msg: 'El salario base es obligatorio' },
        isDecimal: { msg: 'El salario base debe ser un valor numérico' }
      },
      get() {
        const value = this.getDataValue('salario_base');
        return value === null ? null : parseFloat(value);
      }
    },
    estado: {
      type: DataTypes.ENUM('ACTIVO', 'INACTIVO', 'SUSPENDIDO', 'RETIRADO'),
      defaultValue: 'ACTIVO',
      allowNull: false
    },
    eps: {
      type: DataTypes.STRING,
      allowNull: true
    },
    fondo_pension: {
      type: DataTypes.STRING,
      allowNull: true
    },
    arl: {
      type: DataTypes.STRING,
      allowNull: true
    },
    tipo_contrato: {
      type: DataTypes.STRING,
      allowNull: true
    },
    licencia_conduccion: {
      type: DataTypes.STRING,
      allowNull: true
    },
    categoria_licencia: {
      type: DataTypes.STRING,
      allowNull: true
    },
    vencimiento_licencia: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    ultimo_acceso: {
      type: DataTypes.DATE,
      allowNull: true
    },
    sede_trabajo: {
      type: DataTypes.ENUM('Yopal', 'Villanueva', 'Tauramena'),
      allowNull: true,
      validate: {
        isIn: {
          args: [['Yopal', 'Villanueva', 'Tauramena']],
          msg: 'La sede de trabajo debe ser Yopal, Villanueva o Tauramena'
        }
      }
    },
    permisos: {
      type: DataTypes.JSONB,
      defaultValue: {
        verViajes: true,
        verMantenimientos: true,
        verDocumentos: true,
        actualizarPerfil: true
      }
    }
  }, {
    sequelize,
    modelName: 'Conductor',
    tableName: 'conductores',
    underscored: true,
    timestamps: true,
    hooks: {
      beforeSave: async (conductor) => {
        // Hash de contraseña antes de guardar, pero solo si existe y ha cambiado
        if (conductor.changed('password') && conductor.password !== null && conductor.password !== undefined) {
          // Verificar que la contraseña no sea una cadena vacía
          if (conductor.password.trim() !== '') {
            const salt = await bcrypt.genSalt(10);
            conductor.password = await bcrypt.hash(conductor.password, salt);
          } else {
            // Si la contraseña es una cadena vacía o solo con espacios, la establecemos como null
            conductor.password = null;
          }
        }
      },
      beforeValidate: (conductor) => {
        // Convertir cadenas vacías a null para email
        if (conductor.email !== null && conductor.email !== undefined && conductor.email.trim() === '') {
          conductor.email = null;
        }

        // Convertir cadenas vacías a null para password
        if (conductor.password !== null && conductor.password !== undefined && conductor.password.trim() === '') {
          conductor.password = null;
        }
      }
    }
  });

  Conductor.associate = (models) => {
    if (models.User) {
      Conductor.belongsTo(models.User, {
        foreignKey: 'creado_por_id',
        as: 'creadoPor'
      });
    }

    if (models.Documento) {
      Conductor.hasMany(models.Documento, {
        foreignKey: 'modelo_id',
        constraints: false,
        scope: { modelo_tipo: 'Conductor' }
      });
    }

    if (models.Liquidacion) {
      Conductor.hasMany(models.Liquidacion, {
        foreignKey: 'conductor_id',
        as: 'liquidaciones'
      });
    }

    if (models.Anticipo) {
      Conductor.hasMany(models.Anticipo, {
        foreignKey: 'conductor_id',
        as: 'anticipos'
      });
    }

    if (models.Vehiculo) {
      Conductor.hasMany(models.Vehiculo, {
        foreignKey: 'conductor_id',
        as: 'vehiculos'
      });
    }
  };

  return Conductor;
};