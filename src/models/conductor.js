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
      allowNull: true, // ✅ Permitir NULL para procesamiento con IA
      validate: {
        // Validar solo si no es null
        nombreValidation(value) {
          if (value !== null && value !== undefined && value !== '') {
            if (value.trim().length < 2) {
              throw new Error('El nombre debe tener al menos 2 caracteres');
            }
          }
        }
      }
    },
    apellido: {
      type: DataTypes.STRING,
      allowNull: true, // ✅ Permitir NULL para procesamiento con IA
      validate: {
        // Validar solo si no es null
        apellidoValidation(value) {
          if (value !== null && value !== undefined && value !== '') {
            if (value.trim().length < 2) {
              throw new Error('El apellido debe tener al menos 2 caracteres');
            }
          }
        }
      }
    },
    tipo_identificacion: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'CC',
      validate: {
        notNull: { msg: 'El tipo de identificación es obligatorio' },
        notEmpty: { msg: 'El tipo de identificación no puede estar vacío' }
      }
    },
    numero_identificacion: {
      type: DataTypes.STRING,
      allowNull: true, // ✅ Permitir NULL temporalmente para procesamiento
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
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
      allowNull: true, // ✅ CAMBIADO: Permitir NULL
      validate: {
        // Validar solo si no es null
        telefoneValidation(value) {
          if (value !== null && value !== undefined && value !== '') {
            if (value.length < 7) {
              throw new Error('El teléfono debe tener al menos 7 caracteres');
            }
          }
        }
      }
    },
    password: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        passwordValidation(value) {
          if (value !== null && value !== undefined && value !== '') {
            if (value.length < 8 || value.length > 16) {
              throw new Error('La contraseña debe tener entre 8 y 16 caracteres');
            }
          }
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
    fecha_ingreso: {
      type: DataTypes.DATEONLY,
      allowNull: true, // ✅ CAMBIADO: Permitir NULL
      validate: {
        // Validar solo si no es null
        fechaIngresoValidation(value) {
          if (value !== null && value !== undefined && value !== '') {
            if (!Date.parse(value)) {
              throw new Error('La fecha de ingreso debe ser válida');
            }
          }
        }
      }
    },
    salario_base: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true, // ✅ CAMBIADO: Permitir NULL
      validate: {
        // Validar solo si no es null
        salarioValidation(value) {
          if (value !== null && value !== undefined && value !== '') {
            if (isNaN(value) || parseFloat(value) < 0) {
              throw new Error('El salario base debe ser un número válido mayor o igual a 0');
            }
          }
        }
      },
      get() {
        const value = this.getDataValue('salario_base');
        return value === null ? null : parseFloat(value);
      }
    },
    estado: {
      type: DataTypes.ENUM('servicio', 'disponible', 'descanso', 'vacaciones', 'incapacidad', 'desvinculado'),
      defaultValue: 'disponible',
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
    termino_contrato: {
      type: DataTypes.STRING,
      allowNull: true
    },
    fecha_terminacion: {
      type: DataTypes.STRING,
      allowNull: true
    },
    licencia_conduccion: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: null,
      validate: {
        isValidLicenciaObject(value) {
          if (value === null || value === undefined) return;

          if (typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('licencia_conduccion debe ser un objeto');
          }

          const { fecha_expedicion, categorias } = value;
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

          if (!fecha_expedicion || typeof fecha_expedicion !== 'string' || !dateRegex.test(fecha_expedicion)) {
            throw new Error('fecha_expedicion debe estar presente y tener formato YYYY-MM-DD');
          }

          if (!Array.isArray(categorias)) {
            throw new Error('categorias debe ser un array');
          }

          const categoriasValidas = ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];

          for (const item of categorias) {
            if (typeof item !== 'object' || item === null) {
              throw new Error('Cada categoría debe ser un objeto');
            }

            if (!item.categoria || typeof item.categoria !== 'string') {
              throw new Error('Cada categoría debe tener un campo categoria válido');
            }

            if (!categoriasValidas.includes(item.categoria)) {
              throw new Error(`Categoría ${item.categoria} no es válida`);
            }

            if (!item.vigencia_hasta || typeof item.vigencia_hasta !== 'string' || !dateRegex.test(item.vigencia_hasta)) {
              throw new Error(`vigencia_hasta debe tener formato YYYY-MM-DD`);
            }
          }
        }
      }
    },
    ultimo_acceso: {
      type: DataTypes.DATE,
      allowNull: true
    },
    sede_trabajo: {
      type: DataTypes.ENUM('YOPAL', 'VILLANUEVA', 'TAURAMENA'),
      allowNull: true,
      validate: {
        isIn: {
          args: [['YOPAL', 'VILLANUEVA', 'TAURAMENA']],
          msg: 'La sede de trabajo debe ser Yopal, Villanueva o Tauramena'
        }
      }
    },
    tipo_sangre: {
      type: DataTypes.ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'),
      allowNull: true,
      validate: {
        isIn: {
          args: [['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']],
          msg: 'El tipo de sangre debe ser uno de: A+, A-, B+, B-, AB+, AB-, O+, O-'
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
    },
    // ✅ CAMPOS DE AUDITORÍA
    creado_por_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    actualizado_por_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    }
  }, {
    sequelize,
    modelName: 'Conductor',
    tableName: 'conductores',
    underscored: true,
    timestamps: true,
    hooks: {
      // ✅ HOOK ANTES DE VALIDAR
      beforeValidate: (conductor) => {
        // Convertir cadenas vacías a null para email
        if (conductor.email !== null && conductor.email !== undefined && conductor.email.trim() === '') {
          conductor.email = null;
        }

        // Convertir cadenas vacías a null para password
        if (conductor.password !== null && conductor.password !== undefined && conductor.password.trim() === '') {
          conductor.password = null;
        }
      },

      // ✅ HOOK ANTES DE CREAR
      beforeCreate: async (conductor, options) => {
        // Hash de contraseña si existe
        if (conductor.password !== null && conductor.password !== undefined && conductor.password.trim() !== '') {
          const salt = await bcrypt.genSalt(10);
          conductor.password = await bcrypt.hash(conductor.password, salt);
        }

        // ✅ ESTABLECER CREADO_POR
        if (options && options.user_id) {
          conductor.creado_por_id = options.user_id;
          conductor.actualizado_por_id = options.user_id; // También es quien lo actualizó por primera vez
          console.log(`🆕 Conductor creado por usuario: ${options.user_id}`);
        } else {
          console.log('⚠️ No se proporcionó user_id en options para el conductor creado');
        }
      },

      // ✅ HOOK ANTES DE ACTUALIZAR
      beforeUpdate: async (conductor, options) => {
        // Hash de contraseña solo si ha cambiado
        if (conductor.changed('password') && conductor.password !== null && conductor.password !== undefined) {
          if (conductor.password.trim() !== '') {
            const salt = await bcrypt.genSalt(10);
            conductor.password = await bcrypt.hash(conductor.password, salt);
          } else {
            conductor.password = null;
          }
        }

        // ✅ ESTABLECER ACTUALIZADO_POR
        if (options && options.user_id) {
          conductor.actualizado_por_id = options.user_id;
          console.log(`🔄 Conductor ${conductor.id} actualizado por usuario: ${options.user_id}`);
        } else {
          console.log('⚠️ No se proporcionó user_id en options para el conductor actualizado');
        }
      },

      // ✅ HOOK GENÉRICO ANTES DE GUARDAR (para casos no cubiertos por create/update)
      beforeSave: async (conductor, options) => {
        // Este hook actúa como fallback para casos especiales
        // Los casos normales ya se manejan en beforeCreate y beforeUpdate

        // Solo procesar contraseña si no se procesó en beforeCreate o beforeUpdate
        if (conductor.isNewRecord) {
          // Ya se manejó en beforeCreate
          return;
        }

        // Para updates que no pasaron por beforeUpdate
        if (conductor.changed('password') && conductor.password !== null && conductor.password !== undefined) {
          if (conductor.password.trim() !== '') {
            // Solo hacer hash si no parece estar ya hasheada (bcrypt hashes start with $2)
            if (!conductor.password.startsWith('$2')) {
              const salt = await bcrypt.genSalt(10);
              conductor.password = await bcrypt.hash(conductor.password, salt);
            }
          } else {
            conductor.password = null;
          }
        }
      }
    }
  });

  Conductor.associate = (models) => {
    if (models.User) {
      // ✅ ASOCIACIÓN PARA CREADO_POR
      Conductor.belongsTo(models.User, {
        foreignKey: 'creado_por_id',
        as: 'creadoPor'
      });

      // ✅ ASOCIACIÓN PARA ACTUALIZADO_POR
      Conductor.belongsTo(models.User, {
        foreignKey: 'actualizado_por_id',
        as: 'actualizadoPor'
      });
    }

    if (models.Documento) {
      Conductor.hasMany(models.Documento, {
        foreignKey: 'conductor_id',
        as: 'documentos'
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