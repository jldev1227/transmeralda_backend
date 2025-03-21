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
      periodoStart: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notNull: { msg: "La fecha de inicio del periodo es obligatoria" },
          notEmpty: {
            msg: "La fecha de inicio del periodo no puede estar vacía",
          },
        },
      },
      periodoEnd: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notNull: { msg: "La fecha de fin del periodo es obligatoria" },
          notEmpty: { msg: "La fecha de fin del periodo no puede estar vacía" },
        },
      },
      auxilioTransporte: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: {
            msg: "El auxilio de transporte debe ser un valor numérico",
          },
        },
        get() {
          const value = this.getDataValue("auxilioTransporte");
          return value === null ? null : parseFloat(value);
        },
      },
      sueldoTotal: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El sueldo total debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("sueldoTotal");
          return value === null ? null : parseFloat(value);
        },
      },
      salarioDevengado: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El salario devengado debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("salarioDevengado");
          return value === null ? null : parseFloat(value);
        },
      },
      totalPernotes: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El total de pernotes debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("totalPernotes");
          return value === null ? null : parseFloat(value);
        },
      },
      totalBonificaciones: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: {
            msg: "El total de bonificaciones debe ser un valor numérico",
          },
        },
        get() {
          const value = this.getDataValue("totalBonificaciones");
          return value === null ? null : parseFloat(value);
        },
      },
      totalRecargos: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El total de recargos debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("totalRecargos");
          return value === null ? null : parseFloat(value);
        },
      },
      totalAnticipos: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: {
            msg: "El total de anticipos debe ser un valor numérico",
          },
        },
        get() {
          const value = this.getDataValue("totalAnticipos");
          return value === null ? null : parseFloat(value);
        },
      },
      totalVacaciones: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: {
            msg: "El total de vacaciones debe ser un valor numérico",
          },
        },
        get() {
          const value = this.getDataValue("totalVacaciones");
          return value === null ? null : parseFloat(value);
        },
      },
      periodoStartVacaciones: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      periodoEndVacaciones: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      diasLaborados: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          isInt: { msg: "Los días laborados deben ser un número entero" },
        },
      },
      diasLaboradosVillanueva: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          isInt: {
            msg: "Los días laborados en Villanueva deben ser un número entero",
          },
        },
      },
      diasLaboradosAnual: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          isInt: {
            msg: "Los días laborados anuales deben ser un número entero",
          },
        },
      },
      ajusteSalarial: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: { msg: "El ajuste salarial debe ser un valor numérico" },
        },
        get() {
          const value = this.getDataValue("ajusteSalarial");
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
      interesCesantias: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
        validate: {
          isDecimal: {
            msg: "El valor de interés de cesantías debe ser un valor numérico",
          },
        },
        get() {
          const value = this.getDataValue('interesCesantias');
          return value === null ? null : parseFloat(value);
        }
      },
      estado: {
        type: DataTypes.ENUM("Pendiente", "Liquidado"),
        allowNull: false,
        defaultValue: "Pendiente",
      },
      fechaLiquidacion: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      observaciones: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
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
            liquidacion.diasLaborados > 0 ||
            liquidacion.diasLaboradosVillanueva > 0 ||
            liquidacion.diasLaboradosAnual > 0
          ) {
            liquidacion.estado = "Liquidado";
            liquidacion.fechaLiquidacion = new Date();
          }

          // Registrar creador
          if (options.user) {
            liquidacion.creado_por_id = options.user.id;
          }
        },
        beforeUpdate: (liquidacion, options) => {
          // Determinar estado basado en días laborados
          if (
            liquidacion.diasLaborados > 0 ||
            liquidacion.diasLaboradosVillanueva > 0 ||
            liquidacion.diasLaboradosAnual > 0
          ) {
            liquidacion.estado = "Liquidado";
            if (!liquidacion.fechaLiquidacion) {
              liquidacion.fechaLiquidacion = new Date();
            }
          } else {
            liquidacion.estado = "Pendiente";
            liquidacion.fechaLiquidacion = null;
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
