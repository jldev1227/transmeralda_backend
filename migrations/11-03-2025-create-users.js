module.exports = {
    up: async (queryInterface, Sequelize) => {
      await queryInterface.createTable('users', {
        id: {
          allowNull: false,
          primaryKey: true,
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4
        },
        nombre: {
          type: Sequelize.STRING,
          allowNull: false
        },
        correo: {
          type: Sequelize.STRING,
          allowNull: false,
          unique: true
        },
        password: {
          type: Sequelize.STRING,
          allowNull: false
        },
        telefono: {
          type: Sequelize.STRING,
          allowNull: true
        },
        role: {
          type: Sequelize.ENUM('admin', 'gestor_flota', 'gestor_nomina', 'usuario'),
          defaultValue: 'usuario'
        },
        permisos: {
          type: Sequelize.JSONB,
          defaultValue: {
            flota: false,
            nomina: false,
            admin: false
          }
        },
        ultimo_acceso: {
          type: Sequelize.DATE,
          allowNull: true
        },
        created_at: {
          allowNull: false,
          type: Sequelize.DATE
        },
        updated_at: {
          allowNull: false,
          type: Sequelize.DATE
        }
      });
  
      // Crear índices para optimizar búsquedas
      await queryInterface.addIndex('users', ['correo']);
      await queryInterface.addIndex('users', ['role']);
    },
  
    down: async (queryInterface, Sequelize) => {
      await queryInterface.dropTable('users');
    }
  };
  