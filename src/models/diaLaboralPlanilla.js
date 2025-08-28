const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class DiaLaboralPlanilla extends Model {
    // Calcular totales de recargos dinámicamente
    async calcularTotalesRecargos() {
      const detalles = await this.getDetallesRecargos({
        include: [{
          model: sequelize.models.TipoRecargo,
          as: 'tipoRecargo'
        }]
      });

      const totales = {};

      detalles.forEach(detalle => {
        const codigo = detalle.tipoRecargo.codigo;
        totales[codigo.toLowerCase()] = parseFloat(detalle.horas) || 0;
      });

      return totales;
    }

    // Obtener recargo por tipo
    async obtenerRecargoPorTipo(codigoTipo) {
      const detalle = await this.getDetallesRecargos({
        include: [{
          model: sequelize.models.TipoRecargo,
          as: 'tipoRecargo',
          where: { codigo: codigoTipo }
        }]
      });

      return detalle.length > 0 ? parseFloat(detalle[0].horas) : 0;
    }

    // Establecer horas para un tipo específico
    async establecerRecargo(codigoTipo, horas) {
      const tipoRecargo = await sequelize.models.TipoRecargo.findOne({
        where: { codigo: codigoTipo, activo: true }
      });

      if (!tipoRecargo) {
        throw new Error(`Tipo de recargo ${codigoTipo} no encontrado`);
      }

      const [detalle, created] = await sequelize.models.DetalleRecargosDia.findOrCreate({
        where: {
          dia_laboral_id: this.id,
          tipo_recargo_id: tipoRecargo.id
        },
        defaults: {
          horas: horas
        }
      });

      if (!created) {
        await detalle.update({ horas: horas });
      }

      return detalle;
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
        min: { args: [1], msg: 'El día debe ser mayor a 0' },
        max: { args: [31], msg: 'El día no puede ser mayor a 31' }
      },
    },
    hora_inicio: {
      type: DataTypes.DECIMAL(4, 1),
      allowNull: true,
      validate: {
        min: { args: [0], msg: 'La hora de inicio no puede ser negativa' },
        max: { args: [24], msg: 'La hora de inicio no puede ser mayor a 24' }
      },
    },
    hora_fin: {
      type: DataTypes.DECIMAL(4, 1),
      allowNull: true,
      validate: {
        min: { args: [0], msg: 'La hora de fin no puede ser negativa' },
        max: { args: [24], msg: 'La hora de fin no puede ser mayor a 24' }
      },
    },
    total_horas: {
      type: DataTypes.DECIMAL(6, 1),
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: { args: [0], msg: 'Las horas totales no pueden ser negativas' }
      },
      get() {
        const value = this.getDataValue('total_horas');
        return value === null ? 0 : parseFloat(value);
      },
    },
    horas_ordinarias: {
      type: DataTypes.DECIMAL(6, 1),
      defaultValue: 0,
      get() {
        const value = this.getDataValue('horas_ordinarias');
        return value === null ? 0 : parseFloat(value);
      },
    },
    es_festivo: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    es_domingo: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    creado_por_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
    },
    actualizado_por_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
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
        fields: ['recargo_planilla_id', 'dia'],
        unique: true,
        name: 'idx_dia_laboral_planilla_dia'
      }
    ]
  });

  DiaLaboralPlanilla.associate = (models) => {
    if (models.RecargoPlanilla) {
      DiaLaboralPlanilla.belongsTo(models.RecargoPlanilla, {
        foreignKey: 'recargo_planilla_id',
        as: 'recargoPlanilla'
      });
    }
    if (models.DetalleRecargosDia) {
      DiaLaboralPlanilla.hasMany(models.DetalleRecargosDia, {
        foreignKey: 'dia_laboral_id',
        as: 'detallesRecargos',
        onDelete: 'CASCADE'
      });
    }
    if (models.Usuario) {
      DiaLaboralPlanilla.belongsTo(models.Usuario, {
        foreignKey: 'creado_por_id',
        as: 'creadoPor'
      });
      DiaLaboralPlanilla.belongsTo(models.Usuario, {
        foreignKey: 'actualizado_por_id',
        as: 'actualizadoPor'
      });
    }
  };


  return DiaLaboralPlanilla;
};
