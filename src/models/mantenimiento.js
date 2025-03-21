const { DataTypes, Model } = require("sequelize");

class Mantenimiento extends Model {}

module.exports = (sequelize) => {
  Mantenimiento.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
        primaryKey: true,
      },
      values: {
        type: DataTypes.TEXT, // PostgreSQL maneja TEXT bien para JSON strings
        allowNull: false,
        defaultValue: '[]', 
        get() {
          const rawValue = this.getDataValue('values');
          return rawValue ? JSON.parse(rawValue) : [];
        },
        set(value) {
          this.setDataValue('values', JSON.stringify(value));
        }
      },
      value: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      vehiculoId: {
        type: DataTypes.UUID, // Cambiado a UUID
        allowNull: true,
        references: {
          model: 'vehiculos', // En PostgreSQL, los nombres de tablas suelen estar en minúsculas
          key: 'id'
        },
        onDelete: 'SET NULL',
      },
      liquidacionId: {
        type: DataTypes.UUID, // Cambiado a UUID
        allowNull: true,
        references: {
          model: 'liquidaciones', // En PostgreSQL, los nombres de tablas suelen estar en minúsculas
          key: 'id'
        },
        onDelete: 'SET NULL',
      }
    },
    {
      sequelize,
      modelName: "Mantenimiento",
      tableName: "mantenimientos", // Explícitamente establecer nombre de tabla en minúsculas para PostgreSQL
      timestamps: true,
      underscored: true, // Para seguir convención snake_case en PostgreSQL
    }
  );

  // Definir asociaciones
  Mantenimiento.associate = (models) => {
    Mantenimiento.belongsTo(models.Vehiculo, {
      foreignKey: 'vehiculo_id',
      as: 'vehiculo'
    });
    
    Mantenimiento.belongsTo(models.Liquidacion, {
      foreignKey: 'liquidacionId',
      as: 'liquidacion'
    });
  };

  return Mantenimiento;
};