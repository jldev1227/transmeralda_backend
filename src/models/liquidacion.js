// src/models/liquidacion.js
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Liquidacion extends Model {
    // Método para calcular totales
    calcularTotales() {
      return {
        total:
          parseFloat(this.sueldoTotal) +
          parseFloat(this.totalBonificaciones) +
          parseFloat(this.totalPernotes) +
          parseFloat(this.totalRecargos) -
          parseFloat(this.totalAnticipos),
      };
    }
  }

  Liquidacion.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      periodo_start: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notNull: { msg: "La fecha de inicio del periodo es obligatoria" },
          notEmpty: {
            msg: "La fecha de inicio del periodo no puede estar vacía",
          },
        },
      },
      periodo_end: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notNull: { msg: "La fecha de fin del periodo es obligatoria" },
          notEmpty: { msg: "La fecha de fin del periodo no puede estar vacía" },
        },
      },
      auxilio_transporte: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: {
            msg: "El auxilio de transporte debe ser un valor numérico",
          },
        },
        get() {
          const value = this.getDataValue("auxilio_transporte");
          return value === null ? null : parseFloat(value);
        },
      },
      sueldo_total: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El sueldo total debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("sueldo_total");
          return value === null ? null : parseFloat(value);
        },
      },
      salario_devengado: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El salario devengado debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("salario_devengado");
          return value === null ? null : parseFloat(value);
        },
      },
      total_pernotes: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El total de pernotes debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("total_pernotes");
          return value === null ? null : parseFloat(value);
        },
      },
      total_bonificaciones: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: {
            msg: "El total de bonificaciones debe ser un valor numérico",
          },
        },
        get() {
          const value = this.getDataValue("total_bonificaciones");
          return value === null ? null : parseFloat(value);
        },
      },
      total_recargos: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El total de recargos debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("total_recargos");
          return value === null ? null : parseFloat(value);
        },
      },
      total_anticipos: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: {
            msg: "El total de anticipos debe ser un valor numérico",
          },
        },
        get() {
          const value = this.getDataValue("total_anticipos");
          return value === null ? null : parseFloat(value);
        },
      },
      total_vacaciones: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: {
            msg: "El total de vacaciones debe ser un valor numérico",
          },
        },
        get() {
          const value = this.getDataValue("total_vacaciones");
          return value === null ? null : parseFloat(value);
        },
      },
      periodo_start_vacaciones: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      periodo_end_vacaciones: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      periodo_start_incapacidad: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      periodo_end_incapacidad: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      dias_laborados: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          isInt: { msg: "Los días laborados deben ser un número entero" },
        },
      },
      dias_laborados_villanueva: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          isInt: {
            msg: "Los días laborados en Villanueva deben ser un número entero",
          },
        },
      },
      dias_laborados_anual: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          isInt: {
            msg: "Los días laborados anuales deben ser un número entero",
          },
        },
      },
      ajuste_salarial: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El ajuste salarial debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("ajuste_salarial");
          return value === null ? null : parseFloat(value);
        },
      },
      ajuste_parex: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El ajuste salarial debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("ajuste_parex");
          return value === null ? null : parseFloat(value);
        },
      },
      ajuste_salarial_por_dia: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false, // Cambiar de 0 a false para boolean
        // Remover validate ya que no aplica para boolean
        // Remover get() ya que no necesitas parsing para boolean
      },
      es_cotransmeq: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Indica si la liquidación es para COTRANSMEQ'
      },
      valor_incapacidad: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El valor incapacidad debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("valor_incapacidad");
          return value === null ? null : parseFloat(value);
        },
      },
      salud: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El valor de salud debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("salud");
          return value === null ? null : parseFloat(value);
        },
      },
      pension: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El valor de pensión debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("pension");
          return value === null ? null : parseFloat(value);
        },
      },
      cesantias: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: {
            msg: "El valor de cesantías debe ser un valor numérico",
          },
        },
        get() {
          const value = this.getDataValue('cesantias');
          return value === null ? null : parseFloat(value);
        }
      },
      interes_cesantias: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: {
            msg: "El valor de interés de cesantías debe ser un valor numérico",
          },
        },
        get() {
          const value = this.getDataValue('interes_cesantias');
          return value === null ? null : parseFloat(value);
        }
      },
      prima: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: {
            msg: "El valor de prima debe ser un valor numérico",
          },
        },
        get() {
          const value = this.getDataValue('prima');
          return value === null ? null : parseFloat(value);
        }
      },
      prima_pendiente: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: null,
        validate: {
          isDecimal: {
            msg: "El valor de prima pendiente debe ser un valor numérico",
          },
        },
        get() {
          const value = this.getDataValue('prima_pendiente');
          return value === null ? null : parseFloat(value);
        }
      },
      estado: {
        type: DataTypes.ENUM("Pendiente", "Liquidado"),
        allowNull: false,
        defaultValue: "Pendiente",
      },
      fecha_liquidacion: {
        type: DataTypes.DATE,
        allowNull: true,
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
      liquidado_por_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      conceptos_adicionales: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: [],
        validate: {
          isValidConceptos(value) {
            if (value === null || value === undefined) return true;
            
            if (!Array.isArray(value)) {
              throw new Error('conceptos_adicionales debe ser un array');
            }
            
            if (value.length > 20) {
              throw new Error('No se pueden agregar más de 20 conceptos adicionales');
            }
            
            value.forEach((concepto, index) => {
              if (typeof concepto.valor !== 'number') {
                throw new Error(`Concepto ${index + 1}: valor debe ser un número`);
              }
              
              if (concepto.valor === 0) {
                throw new Error(`Concepto ${index + 1}: valor no puede ser cero`);
              }
              
              if (Math.abs(concepto.valor) > 10000000) {
                throw new Error(`Concepto ${index + 1}: valor excede el límite permitido (10 millones)`);
              }
              
              if (!concepto.observaciones || typeof concepto.observaciones !== 'string') {
                throw new Error(`Concepto ${index + 1}: observaciones es requerido`);
              }
              
              if (concepto.observaciones.trim().length < 3) {
                throw new Error(`Concepto ${index + 1}: observaciones debe tener al menos 3 caracteres`);
              }
              
              if (concepto.observaciones.length > 500) {
                throw new Error(`Concepto ${index + 1}: observaciones no puede exceder 500 caracteres`);
              }
            });
          }
        }
      }
    },
    {
      sequelize,
      modelName: "Liquidacion",
      tableName: "liquidaciones",
      underscored: true,
      hooks: {
        beforeCreate: (liquidacion, options) => {
          // Determinar estado basado en días laborados
          if (
            liquidacion.dias_laborados > 0 ||
            liquidacion.dias_laborados_villanueva > 0 ||
            liquidacion.dias_laborados_anual > 0
          ) {
            liquidacion.estado = "Liquidado";
            liquidacion.fecha_liquidacion = new Date();
            liquidacion.liquidado_por_id = options.user.id;
          }

          // Registrar creador
          if (options.user) {
            liquidacion.creado_por_id = options.user.id;
          }
        },
        beforeUpdate: (liquidacion, options) => {
          // Determinar estado basado en días laborados
          if (
            liquidacion.dias_laborados > 0 ||
            liquidacion.dias_laborados_villanueva > 0 ||
            liquidacion.dias_laborados_anual > 0
          ) {
            liquidacion.estado = "Liquidado";
            if (!liquidacion.fecha_liquidacion) {
              liquidacion.fecha_liquidacion = new Date();
            }
          } else {
            liquidacion.estado = "Pendiente";
            liquidacion.fecha_liquidacion = null;
          }

          // Registrar actualizador
          if (options.user) {
            liquidacion.actualizado_por_id = options.user.id;
            if (
              liquidacion.estado === "Liquidado" &&
              !liquidacion.liquidado_por_id
            ) {
              liquidacion.liquidado_por_id = options.user.id;
            }
          }
        },
      },
    }
  );

  Liquidacion.associate = (models) => {
    Liquidacion.belongsTo(models.Conductor, {
      foreignKey: "conductor_id",
      as: "conductor",
    });

    // Asociación con Vehiculo (muchos a muchos)
    Liquidacion.belongsToMany(models.Vehiculo, {
      through: "liquidacion_vehiculo", // Nombre de la tabla pivot
      foreignKey: "liquidacion_id", // Nombre de la columna en la tabla pivot
      otherKey: "vehiculo_id", // Nombre de la columna para la otra tabla en la tabla pivot
      as: "vehiculos",
    });

    Liquidacion.belongsTo(models.User, {
      foreignKey: "creado_por_id",
      as: "creadoPor",
    });

    Liquidacion.belongsTo(models.User, {
      foreignKey: "actualizado_por_id",
      as: "actualizadoPor",
    });

    Liquidacion.belongsTo(models.User, {
      foreignKey: "liquidado_por_id",
      as: "liquidadoPor",
    });

    Liquidacion.hasMany(models.Anticipo, {
      foreignKey: "liquidacion_id",
      as: "anticipos",
    });

    Liquidacion.hasMany(models.Bonificacion, {
      foreignKey: "liquidacion_id",
      as: "bonificaciones",
    });

    Liquidacion.hasMany(models.Mantenimiento, {
      foreignKey: "liquidacion_id",
      as: "mantenimientos",
    });

    Liquidacion.hasMany(models.Recargo, {
      foreignKey: "liquidacion_id",
      as: "recargos",
    });

    Liquidacion.hasMany(models.Pernote, {
      foreignKey: "liquidacion_id",
      as: "pernotes",
    });
  };

  return Liquidacion;
};
