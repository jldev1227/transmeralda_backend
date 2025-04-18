const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Municipio extends Model {
    // Método para serializar el municipio
    toJSON() {
      const values = { ...this.get() };
      return values;
    }
  }

  Municipio.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    codigo_departamento: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        notNull: { msg: 'El código de departamento es obligatorio' },
        isInt: { msg: 'El código de departamento debe ser un número entero' }
      }
    },
    nombre_departamento: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El nombre del departamento es obligatorio' },
        notEmpty: { msg: 'El nombre del departamento no puede estar vacío' }
      }
    },
    codigo_municipio: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: { msg: 'Este código de municipio ya está registrado' },
      validate: {
        notNull: { msg: 'El código de municipio es obligatorio' },
        isInt: { msg: 'El código de municipio debe ser un número entero' }
      }
    },
    nombre_municipio: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El nombre del municipio es obligatorio' },
        notEmpty: { msg: 'El nombre del municipio no puede estar vacío' }
      }
    },
    tipo: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El tipo es obligatorio' },
        notEmpty: { msg: 'El tipo no puede estar vacío' },
        isIn: {
          args: [['Municipio', 'Isla', 'Área no municipalizada']],
          msg: 'El tipo debe ser Municipio, Isla o Área no municipalizada'
        }
      }
    },
    longitud: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: false,
      validate: {
        notNull: { msg: 'La longitud es obligatoria' },
        isDecimal: { msg: 'La longitud debe ser un valor decimal' }
      }
    },
    latitud: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: false,
      validate: {
        notNull: { msg: 'La latitud es obligatoria' },
        isDecimal: { msg: 'La latitud debe ser un valor decimal' }
      }
    }
  }, {
    sequelize,
    modelName: 'Municipio',
    tableName: 'municipios',
    underscored: true, // Usar snake_case en la base de datos
    timestamps: true // Incluir created_at y updated_at
  });
  
  return Municipio;
};