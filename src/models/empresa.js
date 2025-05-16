const { DataTypes, Model } = require('sequelize');


module.exports = (sequelize) => {
  class Empresa extends Model {
    static associate(models) {
      // Define associations here if needed
      // Example: 
      // this.hasMany(models.Proyecto, { foreignKey: 'empresaId' });
    }
  }
  Empresa.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      nit: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'nit',
        unique: true,
        validate: {
          notEmpty: {
            msg: 'El nit no puede estar vacío'
          },
          isValidNIT(value) {
            // Eliminar puntos de miles y espacios
            const cleanNIT = value.replace(/\./g, '').trim();

            // Verificar que solo contenga números y posiblemente un guion para el dígito de verificación
            if (!/^[0-9]+(-[0-9])?$/.test(cleanNIT)) {
              throw new Error('El nit debe contener solo números y opcionalmente un guion con el dígito de verificación');
            }

            // Si llega aquí, el valor es válido, así que asignamos el valor limpio
            this.setDataValue('nit', cleanNIT);
          }
        },
        set(value) {
          if (value) {
            // Eliminar puntos de miles y espacios al guardar
            const cleanValue = value.replace(/\./g, '').trim();
            this.setDataValue('nit', cleanValue);
          }
        }
      },
      nombre: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notEmpty: {
            msg: 'El nombre de la empresa no puede estar vacío'
          }
        }
      },
      representante: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          // Solo validamos si hay un valor, pero permitimos null
          notEmpty: {
            msg: 'El nombre del representante no puede estar vacío'
          }
        }
      },
      cedula: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          // Solo validamos si hay un valor, pero permitimos null
          notEmpty: {
            msg: 'La cédula no puede estar vacía'
          }
        }
      },
      telefono: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          // Solo validamos si hay un valor, pero permitimos null
          notEmpty: {
            msg: 'El teléfono no puede estar vacío'
          }
        }
      },
      direccion: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          // Solo validamos si hay un valor, pero permitimos null
          notEmpty: {
            msg: 'La dirección no puede estar vacía'
          }
        }
      },
      requiere_osi: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      paga_recargos: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
    },
    {
      sequelize,
      modelName: 'Empresa',
      tableName: 'empresas',
      timestamps: true,
      underscored: false,
      paranoid: true, // Soft delete
    }
  );

  Empresa.associate = (models) => {
    // Una empresa tiene muchos recargos
    Empresa.hasMany(models.Recargo, {
      foreignKey: 'empresa_id',
      as: 'recargos'
    });

    Empresa.hasMany(models.Pernote, {
      foreignKey: 'empresa_id',
      as: 'pernotes'
    });

    // Aquí irían otras asociaciones de Empresa
  };

  return Empresa;
}
