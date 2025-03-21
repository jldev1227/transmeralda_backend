const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class ConfiguracionLiquidacion extends Model {
    static associate(models) {
      // Asociaciones si son necesarias
    }
  }

  ConfiguracionLiquidacion.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    nombre: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El nombre es obligatorio' },
        notEmpty: { msg: 'El nombre no puede estar vacío' }
      }
    },
    valor: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        notNull: { msg: 'El valor es obligatorio' },
        min: { 
          args: [0],
          msg: 'El valor no puede ser negativo'
        }
      },
      get() {
        const value = this.getDataValue("valor");
        return value === null ? null : parseFloat(value);
      },
    },
    tipo: {  // Cambiado de tipoValor a tipo
      type: DataTypes.ENUM(
        'VALOR_NUMERICO', 
        'PORCENTAJE', 
        'MONTO_FIJO', 
        'BOOLEAN', 
        'MULTIPLICADOR',
        'DESCUENTO'
      ),
      allowNull: false,
      defaultValue: 'VALOR_NUMERICO'
    },
    activo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'ConfiguracionLiquidacion',
    tableName: 'configuraciones_liquidacion',
    underscored: true,  // Esto convierte camelCase a snake_case
    timestamps: true,
    paranoid: true
  });

  return ConfiguracionLiquidacion;
};