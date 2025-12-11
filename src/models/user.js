const { Model, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');

module.exports = (sequelize) => {
  class User extends Model {
    // Método para comparar contraseñas
    async compararPassword(candidatePassword) {
      return await bcrypt.compare(candidatePassword, this.password);
    }

    // Método para serializar el usuario (quitar datos sensibles)
    toJSON() {
      const values = { ...this.get() };
      delete values.password;
      return values;
    }
  }

  User.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    nombre: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'El nombre es obligatorio' },
        notEmpty: { msg: 'El nombre no puede estar vacío' }
      }
    },
    correo: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: { msg: 'Este correo ya está registrado' },
      validate: {
        notNull: { msg: 'El correo es obligatorio' },
        notEmpty: { msg: 'El correo no puede estar vacío' },
        isEmail: { msg: 'Debe ser un formato de correo válido' }
      }
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notNull: { msg: 'La contraseña es obligatoria' },
        notEmpty: { msg: 'La contraseña no puede estar vacía' },
        len: {
          args: [8, 100],
          msg: 'La contraseña debe tener al menos 8 caracteres'
        }
      }
    },
    telefono: {
      type: DataTypes.STRING
    },
    role: {
      type: DataTypes.ENUM('admin', 'gestor_servicio', 'gestor_planillas', 'liquidador', 'facturador', 'aprobador', 'gestor_flota', 'gestor_nomina', 'kilometraje', 'consulta', 'usuario'),
      defaultValue: 'usuario'
    },
    permisos: {
      type: DataTypes.JSONB,
      defaultValue: {
        flota: false,
        nomina: false,
        admin: false,
        kilometraje: false
      }
    },
    ultimo_acceso: {
      type: DataTypes.DATE
    }
  }, {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    underscored: true, // Usar snake_case en la base de datos
    hooks: {
      beforeSave: async (user) => {
        // Hash de contraseña antes de guardar
        if (user.changed('password')) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(user.password, salt);
        }
      }
    }
  });
  
  return User;
};