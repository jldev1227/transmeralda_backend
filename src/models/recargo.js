const { DataTypes, Model } = require('sequelize');

class Recargo extends Model {}

module.exports = (sequelize) => {
  Recargo.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      empresa_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'empresas',
          key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      valor: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        get() {
          const value = this.getDataValue("valor");
          return value === null ? null : parseFloat(value);
        },
      },
      pag_cliente: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      mes: {
        type: DataTypes.STRING,
        allowNull: true, 
      },
      vehiculo_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'vehiculos',
          key: 'id'
        }
      },
    },
    {
      sequelize,
      modelName: "Recargo",
      tableName: "recargos",
      underscored: true,
      timestamps: true,
    }
  );

  // Definimos las asociaciones
  Recargo.associate = (models) => {
    Recargo.belongsTo(models.Empresa, {
      foreignKey: 'empresa_id',
      as: 'empresa'
    });
    
    Recargo.belongsTo(models.Vehiculo, {
      foreignKey: 'vehiculo_id',
      as: 'vehiculo'
    });
    
    Recargo.belongsTo(models.Liquidacion, {
      foreignKey: 'liquidacion_id',
      as: 'liquidacion'
    });
  };

  return Recargo;
};