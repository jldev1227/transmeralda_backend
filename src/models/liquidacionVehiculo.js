const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class LiquidacionVehiculo extends Model {}

  LiquidacionVehiculo.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      liquidacionId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "liquidacion_id",
        references: {
          model: "Liquidacion",
          key: "id",
        },
      },
      vehiculoId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "vehiculo_id",
        references: {
          model: "Vehiculo",
          key: "id",
        },
      },
    },
    {
      sequelize,
      modelName: "LiquidacionVehiculo",
      tableName: "liquidacion_vehiculo",
      underscored: true,
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["liquidacion_id", "vehiculo_id"],
        },
      ],
    }
  );

  // Asociaciones
  LiquidacionVehiculo.associate = (models) => {
    // Asociación con Liquidacion
    LiquidacionVehiculo.belongsTo(models.Liquidacion, {
      foreignKey: "liquidacion_id",
      as: "liquidacion",
    });

    // Asociación con Vehiculo
    LiquidacionVehiculo.belongsTo(models.Vehiculo, {
      foreignKey: "vehiculo_id",
      as: "vehiculo",
    });
  };

  return LiquidacionVehiculo;
};
