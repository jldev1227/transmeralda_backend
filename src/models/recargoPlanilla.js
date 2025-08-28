// src/models/recargoPlanilla.js
const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class RecargoPlanilla extends Model {
    // Métodos útiles del modelo
    
    // Verificar si el recargo es editable
    esEditable() {
      return this.estado === 'pendiente' || this.estado === 'liquidada';
    }
  }

  RecargoPlanilla.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },

    // RELACIONES CON OTRAS ENTIDADES
    conductor_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'conductores',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      comment: 'ID del conductor asociado al recargo',
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
      comment: 'ID del vehículo asociado al recargo',
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
      comment: 'ID de la empresa asociada al recargo',
    },

    // INFORMACIÓN BÁSICA DEL RECARGO
    numero_planilla: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true,
      validate: {
        len: {
          args: [0, 50],
          msg: 'El número de planilla no puede exceder 50 caracteres'
        }
      },
      comment: 'Número único de la planilla (ej: PL-2025-07-001)',
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
          msg: 'El mes no puede ser mayor a 12'
        }
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
          msg: 'El año no puede ser mayor a 2100'
        }
      },
      comment: 'Año del recargo',
    },

    // TOTALES CALCULADOS (se actualizan automáticamente)
    total_dias_laborados: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Los días laborados no pueden ser negativos'
        }
      },
      comment: 'Total de días laborados en el período',
    },

    total_horas_trabajadas: {
      type: DataTypes.DECIMAL(6, 1),
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Las horas trabajadas no pueden ser negativas'
        }
      },
      get() {
        const value = this.getDataValue('total_horas_trabajadas');
        return value === null ? 0 : parseFloat(value);
      },
      comment: 'Total de horas trabajadas en el período',
    },

    total_horas_ordinarias: {
      type: DataTypes.DECIMAL(6, 1),
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Las horas ordinarias no pueden ser negativas'
        }
      },
      get() {
        const value = this.getDataValue('total_horas_ordinarias');
        return value === null ? 0 : parseFloat(value);
      },
      comment: 'Total de horas ordinarias en el período',
    },

    // ARCHIVO ADJUNTO
    archivo_planilla_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      validate: {
        isUrl: {
          msg: 'Debe ser una URL válida'
        }
      },
      comment: 'URL del archivo de planilla adjunto',
    },

    archivo_planilla_nombre: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Nombre original del archivo adjunto',
    },

    archivo_planilla_tipo: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Tipo MIME del archivo adjunto',
    },

    archivo_planilla_tamaño: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: {
          args: [0],
          msg: 'El tamaño del archivo no puede ser negativo'
        }
      },
      comment: 'Tamaño del archivo en bytes',
    },

    // INFORMACIÓN ADICIONAL
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

    // CONTROL DE ESTADO
    estado: {
      type: DataTypes.ENUM( 'pendiente', 'liquidada', 'facturada'),
      defaultValue: 'pendiente',
      allowNull: false,
      comment: 'Estado actual del recargo',
    },

    version: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      allowNull: false,
      comment: 'Versión del recargo para control de cambios',
    },

    // AUDITORÍA
    creado_por_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'ID del usuario que creó el recargo',
    },

    actualizado_por_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'ID del usuario que actualizó el recargo por última vez',
    },

  }, {
    sequelize,
    modelName: 'RecargoPlanilla',
    tableName: 'recargos_planillas',
    underscored: true,
    timestamps: true,
    paranoid: true, // Soft deletes
    
    indexes: [],

    hooks: {
      beforeValidate: (recargo) => {
        // Limpiar observaciones vacías
        if (recargo.observaciones !== null && recargo.observaciones !== undefined && recargo.observaciones.trim() === '') {
          recargo.observaciones = null;
        }

        // Generar número de planilla si no existe
        if (!recargo.numero_planilla && recargo.empresa_id && recargo.año && recargo.mes) {
          // Este será generado en el hook beforeCreate
        }
      },

      beforeUpdate: (recargo) => {
        // Incrementar versión en cada actualización
        if (recargo.changed() && !recargo.changed('version')) {
          recargo.version = (recargo.version || 1) + 1;
        }
      },

      afterCreate: async (recargo) => {
        console.log(`✅ Recargo planilla creado: ${recargo.numero_planilla}`);
      },

      afterUpdate: async (recargo) => {
        console.log(`🔄 Recargo planilla actualizado: ${recargo.numero_planilla} (v${recargo.version})`);
      },

      beforeDestroy: async (recargo) => {
        console.log(`🗑️ Eliminando recargo planilla: ${recargo.numero_planilla}`);
      }
    }
  });

  // Asociaciones
  RecargoPlanilla.associate = (models) => {
    // Relación con días laborales
    if (models.DiaLaboralPlanilla) {
      RecargoPlanilla.hasMany(models.DiaLaboralPlanilla, {
        foreignKey: 'recargo_planilla_id',
        as: 'dias_laborales',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
    }

    // Relación con conductor
    if (models.Conductor) {
      RecargoPlanilla.belongsTo(models.Conductor, {
        foreignKey: 'conductor_id',
        as: 'conductor',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      });
    }

    // Relación con vehículo
    if (models.Vehiculo) {
      RecargoPlanilla.belongsTo(models.Vehiculo, {
        foreignKey: 'vehiculo_id',
        as: 'vehiculo',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      });
    }

    // Relación con empresa
    if (models.Empresa) {
      RecargoPlanilla.belongsTo(models.Empresa, {
        foreignKey: 'empresa_id',
        as: 'empresa',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      });
    }

    // Relación con historial
    if (models.HistorialRecargoPlanilla) {
      RecargoPlanilla.hasMany(models.HistorialRecargoPlanilla, {
        foreignKey: 'recargo_planilla_id',
        as: 'historial',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
    }

    // Relación con users (auditoría)
    if (models.Usuario) {
      RecargoPlanilla.belongsTo(models.Usuario, {
        foreignKey: 'creado_por_id',
        as: 'creadoPor',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      });

      RecargoPlanilla.belongsTo(models.Usuario, {
        foreignKey: 'actualizado_por_id',
        as: 'actualizadoPor',
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      });
    }
  };

  return RecargoPlanilla;
};