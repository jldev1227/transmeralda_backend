const { DataTypes, Model } = require('sequelize');


module.exports = (sequelize) =>{
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
        primaryKey: true
      },
      NIT: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'NIT', // Asegúrate de que Sequelize busque exactamente 'NIT'
        unique: true,
        validate: {
          notNull: {
            msg: 'El NIT es obligatorio'
          },
          notEmpty: {
            msg: 'El NIT no puede estar vacío'
          }
        }
      },
      Nombre: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notNull: {
            msg: 'El nombre de la empresa es obligatorio'
          },
          notEmpty: {
            msg: 'El nombre de la empresa no puede estar vacío'
          }
        }
      },
      Representante: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notNull: {
            msg: 'El nombre del representante es obligatorio'
          },
          notEmpty: {
            msg: 'El nombre del representante no puede estar vacío'
          }
        }
      },
      Cedula: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notNull: {
            msg: 'La cédula es obligatoria'
          },
          notEmpty: {
            msg: 'La cédula no puede estar vacía'
          }
        }
      },
      Telefono: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notNull: {
            msg: 'El teléfono es obligatorio'
          },
          notEmpty: {
            msg: 'El teléfono no puede estar vacío'
          }
        }
      },
      Direccion: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notNull: {
            msg: 'La dirección es obligatoria'
          },
          notEmpty: {
            msg: 'La dirección no puede estar vacía'
          }
        }
      },
      old_id: {
        type: DataTypes.INTEGER,
        allowNull: true
      }
    },
    {
      sequelize,
      modelName: 'Empresa',
      tableName: 'empresas',
      timestamps: true,
      underscored: false,
      paranoid: true, // Soft delete
      indexes: [
        {
          unique: true,
          fields: ['NIT']
        }
      ]
    }
  );

  Empresa.associate = (models) => {
    // Una empresa tiene muchos recargos
    Empresa.hasMany(models.Recargo, {
      foreignKey: 'empresa_id',
      as: 'recargos'
    });
    
    // Aquí irían otras asociaciones de Empresa
  };

  return Empresa;
}
