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
        allowNull: true,
        field: 'nit',
        validate: {
          isValidNIT(value) {
            if (value == null) return; // Si llega null, no validar

            const cleanNIT = value.toString().replace(/\./g, '').trim();

            if (!/^[0-9]+(-[0-9])?$/.test(cleanNIT)) {
              throw new Error('El nit debe contener solo números y opcionalmente un guion con el dígito de verificación');
            }

            this.setDataValue('nit', cleanNIT);
          }
        },
        set(value) {
          // Si llega undefined o cadena vacía → guardamos null
          if (value == null || value.toString().trim() === '') {
            this.setDataValue('nit', null);
            return;
          }

          const cleanValue = value.toString().replace(/\./g, '').trim();
          this.setDataValue('nit', cleanValue);
        }
      },
      nombre: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      representante: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      cedula: {
        type: DataTypes.STRING,
        allowNull: true,
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
