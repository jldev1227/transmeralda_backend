const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class DiaLaboralPlanilla extends Model {
    // Método para calcular si es día laboral
    esDiaLaboral() {
      return this.total_horas > 0;
    }

    // Método para obtener tipo de día
    getTipoDia() {
      if (this.es_festivo) return 'festivo';
      if (this.es_domingo) return 'domingo';
      return 'normal';
    }
  }

  DiaLaboralPlanilla.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    recargo_planilla_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'recargos_planillas',
        key: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    dia: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: {
          args: [1],
          msg: 'El día debe ser mayor a 0'
        },
        max: {
          args: [31],
          msg: 'El día debe ser menor o igual a 31'
        },
      },
      comment: 'Día del mes (1-31)',
    },
    hora_inicio: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: false,
      validate: {
        min: {
          args: [0],
          msg: 'La hora de inicio no puede ser negativa'
        },
        max: {
          args: [24],
          msg: 'La hora de inicio no puede ser mayor a 24'
        },
      },
      get() {
        const value = this.getDataValue('hora_inicio');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Hora de inicio en formato decimal (ej: 8.5 = 8:30)',
    },
    hora_fin: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: false,
      validate: {
        min: {
          args: [0],
          msg: 'La hora de fin no puede ser negativa'
        },
        max: {
          args: [24],
          msg: 'La hora de fin no puede ser mayor a 24'
        },
      },
      get() {
        const value = this.getDataValue('hora_fin');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Hora de fin en formato decimal (ej: 17.5 = 17:30)',
    },
    total_horas: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: false,
      validate: {
        min: {
          args: [0],
          msg: 'El total de horas no puede ser negativo'
        },
        max: {
          args: [24],
          msg: 'El total de horas no puede ser mayor a 24'
        },
      },
      get() {
        const value = this.getDataValue('total_horas');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Total de horas trabajadas en el día',
    },
    hed: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Las HED no pueden ser negativas'
        }
      },
      get() {
        const value = this.getDataValue('hed');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Horas Extra Diurnas del día',
    },
    hen: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Las HEN no pueden ser negativas'
        }
      },
      get() {
        const value = this.getDataValue('hen');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Horas Extra Nocturnas del día',
    },
    hefd: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Las HEFD no pueden ser negativas'
        }
      },
      get() {
        const value = this.getDataValue('hefd');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Horas Extra Festivas Diurnas del día',
    },
    hefn: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'Las HEFN no pueden ser negativas'
        }
      },
      get() {
        const value = this.getDataValue('hefn');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Horas Extra Festivas Nocturnas del día',
    },
    rn: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'El RN no puede ser negativo'
        }
      },
      get() {
        const value = this.getDataValue('rn');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Recargo Nocturno del día',
    },
    rd: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: {
          args: [0],
          msg: 'El RD no puede ser negativo'
        }
      },
      get() {
        const value = this.getDataValue('rd');
        return value === null ? null : parseFloat(value);
      },
      comment: 'Recargo Dominical del día',
    },
    es_festivo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Indica si el día es festivo',
    },
    es_domingo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Indica si el día es domingo',
    },
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: {
          args: [0, 500],
          msg: 'Las observaciones no pueden exceder 500 caracteres'
        }
      },
      comment: 'Observaciones específicas del día',
    },
    // Campos de auditoría
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
    modelName: 'DiaLaboralPlanilla',
    tableName: 'dias_laborales_planillas',
    underscored: true,
    timestamps: true,
    paranoid: true,
    indexes: [
      {
        fields: ['recargo_planilla_id'],
        name: 'idx_dias_laborales_recargo',
      },
      {
        fields: ['dia'],
        name: 'idx_dias_laborales_dia',
      },
      {
        fields: ['es_festivo'],
        name: 'idx_dias_laborales_festivo',
      },
      {
        fields: ['es_domingo'],
        name: 'idx_dias_laborales_domingo',
      },
    ],
    hooks: {
      beforeValidate: (diaLaboral) => {
        // Convertir observaciones vacías a null
        if (diaLaboral.observaciones !== null && diaLaboral.observaciones !== undefined && diaLaboral.observaciones.trim() === '') {
          diaLaboral.observaciones = null;
        }
      },

      beforeSave: (diaLaboral, options) => {
        // Calcular total de horas automáticamente
        if (diaLaboral.hora_inicio !== null && diaLaboral.hora_fin !== null) {
          diaLaboral.total_horas = parseFloat(diaLaboral.hora_fin) - parseFloat(diaLaboral.hora_inicio);
        }
      },

      beforeCreate: async (diaLaboral, options) => {
        if (options && options.user_id) {
          diaLaboral.creado_por_id = options.user_id;
          diaLaboral.actualizado_por_id = options.user_id;
        }
      },

      beforeUpdate: async (diaLaboral, options) => {
        if (options && options.user_id) {
          diaLaboral.actualizado_por_id = options.user_id;
        }
      },
    }
  });

  DiaLaboralPlanilla.associate = (models) => {
    // Relación con recargo
    if (models.RecargoPlanilla) {
      DiaLaboralPlanilla.belongsTo(models.RecargoPlanilla, {
        foreignKey: 'recargo_planilla_id',
        as: 'recargo',
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      });
    }

    // Relaciones de auditoría
    if (models.User) {
      DiaLaboralPlanilla.belongsTo(models.User, {
        foreignKey: 'creado_por_id',
        as: 'creadoPor'
      });

      DiaLaboralPlanilla.belongsTo(models.User, {
        foreignKey: 'actualizado_por_id',
        as: 'actualizadoPor'
      });
    }
  };

  return DiaLaboralPlanilla;
};
