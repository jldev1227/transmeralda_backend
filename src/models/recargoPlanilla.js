// src/models/recargoPlanilla.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class RecargoPlanilla extends Model {
    // Métodos del modelo si los necesitas
    calcularTotales() {
      // Lógica para calcular totales de recargos
      return {
        totalHoras: this.total_horas_trabajadas,
        totalHED: this.total_hed,
        totalHEN: this.total_hen,
        // ... otros totales
      };
    }

    esEditable() {
      return ['borrador', 'activo'].includes(this.estado);
    }
  }

  RecargoPlanilla.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    conductor_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'conductores',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    vehiculo_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'vehiculos',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    empresa_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'empresas',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    numero_planilla: {
      type: DataTypes.STRING(50),
      allowNull: true,
      validate: {
        planillaValidation(value) {
          if (value !== null && value !== undefined && value !== '') {
            if (value.trim().length < 1) {
              throw new Error('El número de planilla no puede estar vacío');
            }
          }
        }
      },
      comment: 'Número de planilla TM-XXXX',
    },
    mes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: {
          args: [1],
          msg: 'El mes debe ser mayor a 0'
        },
        max: {
          args: [12],
          msg: 'El mes debe ser menor o igual a 12'
        },
      },
      comment: 'Mes del recargo (1-12)',
    },
    año: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: {
          args: [2000],
          msg: 'El año debe ser mayor a 2000'
        },
        max: {
          args: [2100],
          msg: 'El año debe ser menor a 2100'
        },
      },
      comment: 'Año del recargo',
    },
    total_horas_trabajadas: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Las horas trabajadas no pueden ser negativas'
        }
      },
      get() {
        const value = this.getDataValue('total_horas_trabajadas');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Total de horas trabajadas en el período',
    },
    total_hed: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Las HED no pueden ser negativas'
        }
      },
      get() {
        const value = this.getDataValue('total_hed');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Total Horas Extra Diurnas (25%)',
    },
    total_hen: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Las HEN no pueden ser negativas'
        }
      },
      get() {
        const value = this.getDataValue('total_hen');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Total Horas Extra Nocturnas (75%)',
    },
    total_hefd: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Las HEFD no pueden ser negativas'
        }
      },
      get() {
        const value = this.getDataValue('total_hefd');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Total Horas Extra Festivas Diurnas (100%)',
    },
    total_hefn: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Las HEFN no pueden ser negativas'
        }
      },
      get() {
        const value = this.getDataValue('total_hefn');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Total Horas Extra Festivas Nocturnas (150%)',
    },
    total_rn: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'El RN no puede ser negativo'
        }
      },
      get() {
        const value = this.getDataValue('total_rn');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Total Recargo Nocturno (35%)',
    },
    total_rd: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'El RD no puede ser negativo'
        }
      },
      get() {
        const value = this.getDataValue('total_rd');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Total Recargo Dominical (75%)',
    },
    archivo_planilla_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'URL del archivo de planilla adjunto',
    },
    archivo_planilla_nombre: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        len: {
          args: [1, 255],
          msg: 'El nombre del archivo debe tener entre 1 y 255 caracteres'
        }
      },
      comment: 'Nombre original del archivo adjunto',
    },
    archivo_planilla_tipo: {
      type: DataTypes.STRING(50),
      allowNull: true,
      validate: {
        isIn: {
          args: [['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']],
          msg: 'El tipo de archivo debe ser PDF o imagen válida'
        }
      },
      comment: 'Tipo MIME del archivo adjunto',
    },
    archivo_planilla_tamaño: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: {
          args: [0],
          msg: 'El tamaño del archivo no puede ser negativo'
        },
        max: {
          args: [15728640], // 15MB en bytes
          msg: 'El archivo no puede ser mayor a 15MB'
        }
      },
      comment: 'Tamaño del archivo en bytes',
    },
    estado: {
      type: DataTypes.ENUM('borrador', 'activo', 'revisado', 'aprobado', 'anulado'),
      allowNull: false,
      defaultValue: 'activo',
      validate: {
        isIn: {
          args: [['borrador', 'activo', 'revisado', 'aprobado', 'anulado']],
          msg: 'El estado debe ser: borrador, activo, revisado, aprobado o anulado'
        }
      },
      comment: 'Estado del recargo',
    },
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: {
          args: [0, 1000],
          msg: 'Las observaciones no pueden exceder 1000 caracteres'
        }
      },
      comment: 'Observaciones adicionales del recargo',
    },
    version: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      validate: {
        min: {
          args: [1],
          msg: 'La versión debe ser mayor a 0'
        }
      },
      comment: 'Versión del recargo para control de cambios',
    },
    // Campos de auditoría siguiendo el patrón de Conductor
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
    },
  }, {
    sequelize,
    modelName: 'RecargoPlanilla',
    tableName: 'recargos_planillas',
    underscored: true,
    timestamps: true,
    paranoid: true, // Soft delete
    indexes: [
      {
        fields: ['conductor_id'],
        name: 'idx_recargos_conductor',
      },
      {
        fields: ['vehiculo_id'],
        name: 'idx_recargos_vehiculo',
      },
      {
        fields: ['empresa_id'],
        name: 'idx_recargos_empresa',
      },
      {
        fields: ['mes', 'año'],
        name: 'idx_recargos_periodo',
      },
      {
        fields: ['estado'],
        name: 'idx_recargos_estado',
      },
      {
        fields: ['numero_planilla'],
        name: 'idx_recargos_planilla',
      },
      {
        unique: true,
        fields: ['conductor_id', 'vehiculo_id', 'empresa_id', 'mes', 'año'],
        name: 'unique_recargo_periodo',
        where: {
          deleted_at: null, // Solo para registros no eliminados (paranoid)
        },
      },
    ],
    hooks: {
      // Hook antes de validar
      beforeValidate: (recargo) => {
        // Convertir cadenas vacías a null
        if (recargo.numero_planilla !== null && recargo.numero_planilla !== undefined && recargo.numero_planilla.trim() === '') {
          recargo.numero_planilla = null;
        }
        if (recargo.observaciones !== null && recargo.observaciones !== undefined && recargo.observaciones.trim() === '') {
          recargo.observaciones = null;
        }
      },

      // Hook antes de crear
      beforeCreate: async (recargo, options) => {
        // Establecer creado_por
        if (options && options.user_id) {
          recargo.creado_por_id = options.user_id;
          recargo.actualizado_por_id = options.user_id;
          console.log(`🆕 Recargo creado por usuario: ${options.user_id}`);
        } else {
          console.log('⚠️ No se proporcionó user_id en options para el recargo creado');
        }
      },

      // Hook antes de actualizar
      beforeUpdate: async (recargo, options) => {
        // Incrementar versión y establecer actualizado_por
        recargo.version += 1;
        if (options && options.user_id) {
          recargo.actualizado_por_id = options.user_id;
          console.log(`🔄 Recargo ${recargo.id} actualizado por usuario: ${options.user_id} - Nueva versión: ${recargo.version}`);
        } else {
          console.log('⚠️ No se proporcionó user_id en options para el recargo actualizado');
        }
      },
    }
  });

  // Definir asociaciones en el método associate
  RecargoPlanilla.associate = (models) => {
    // Relaciones principales
    if (models.Conductor) {
      RecargoPlanilla.belongsTo(models.Conductor, {
        foreignKey: 'conductor_id',
        as: 'conductor',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      });
    }

    if (models.Vehiculo) {
      RecargoPlanilla.belongsTo(models.Vehiculo, {
        foreignKey: 'vehiculo_id',
        as: 'vehiculo',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      });
    }

    if (models.Empresa) {
      RecargoPlanilla.belongsTo(models.Empresa, {
        foreignKey: 'empresa_id',
        as: 'empresa',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      });
    }

    // Relaciones con días laborales
    if (models.DiaLaboralPlanilla) {
      RecargoPlanilla.hasMany(models.DiaLaboralPlanilla, {
        foreignKey: 'recargo_planilla_id',
        as: 'dias_laborales',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
    }

    // Relaciones con historial
    if (models.HistorialRecargoPlanilla) {
      RecargoPlanilla.hasMany(models.HistorialRecargoPlanilla, {
        foreignKey: 'recargo_planilla_id',
        as: 'historial',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
    }

    // Relaciones de auditoría
    if (models.User) {
      RecargoPlanilla.belongsTo(models.User, {
        foreignKey: 'creado_por_id',
        as: 'creadoPor'
      });

      RecargoPlanilla.belongsTo(models.User, {
        foreignKey: 'actualizado_por_id',
        as: 'actualizadoPor'
      });
    }
  };

  return RecargoPlanilla;
};

