const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class ServicioLiquidacion extends Model {}

  ServicioLiquidacion.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    servicio_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'servicios',
        key: 'id'
      }
    },
    liquidacion_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'liquidaciones_servicios', // Corregido: debe coincidir con el nombre de la tabla
        key: 'id'
      }
    },
    valor_liquidado: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      validate: {
        notNull: { msg: 'El valor liquidado es obligatorio' },
        isDecimal: { msg: 'El valor liquidado debe ser un número decimal' },
        min: {
          args: [0],
          msg: 'El valor liquidado no puede ser negativo'
        }
      }
    }
  }, {
    sequelize,
    modelName: 'ServicioLiquidacion',
    tableName: 'servicio_liquidaciones',
    underscored: true,
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['servicio_id', 'liquidacion_id']
      }
    ]
  });

  // Agregar asociaciones explícitas
  ServicioLiquidacion.associate = (models) => {
    // Asociación con Servicio
    ServicioLiquidacion.belongsTo(models.Servicio, {
      foreignKey: 'servicio_id',
      as: 'servicio'
    });
    
    // Asociación con LiquidacionServicio
    ServicioLiquidacion.belongsTo(models.LiquidacionServicio, {
      foreignKey: 'liquidacion_id',
      as: 'liquidacion'
    });
  };

  return ServicioLiquidacion;
};