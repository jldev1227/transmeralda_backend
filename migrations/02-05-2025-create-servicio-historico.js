'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('servicio_historicos', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      servicio_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'servicios',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      usuario_id: {
        type: Sequelize.UUID,
        allowNull: false
      },
      usuario_nombre: {
        type: Sequelize.STRING,
        allowNull: true
      },
      campo_modificado: {
        type: Sequelize.STRING,
        allowNull: false
      },
      valor_anterior: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      valor_nuevo: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      tipo_operacion: {
        type: Sequelize.ENUM('creacion', 'actualizacion', 'eliminacion'),
        allowNull: false,
        defaultValue: 'actualizacion'
      },
      fecha_modificacion: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      ip_usuario: {
        type: Sequelize.STRING,
        allowNull: true
      },
      navegador_usuario: {
        type: Sequelize.STRING,
        allowNull: true
      },
      detalles: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      }
    });

    // Crear índices para mejorar el rendimiento de las consultas
    await queryInterface.addIndex('servicio_historicos', ['servicio_id'], {
      name: 'servicio_historicos_servicio_id_idx'
    });

    await queryInterface.addIndex('servicio_historicos', ['usuario_id'], {
      name: 'servicio_historicos_usuario_id_idx'
    });

    await queryInterface.addIndex('servicio_historicos', ['fecha_modificacion'], {
      name: 'servicio_historicos_fecha_modificacion_idx'
    });
  },

  async down(queryInterface, Sequelize) {
    // Eliminar primero los índices
    await queryInterface.removeIndex('servicio_historicos', 'servicio_historicos_servicio_id_idx');
    await queryInterface.removeIndex('servicio_historicos', 'servicio_historicos_usuario_id_idx');
    await queryInterface.removeIndex('servicio_historicos', 'servicio_historicos_fecha_modificacion_idx');

    // Luego eliminar el ENUM type
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_servicio_historicos_tipo_operacion;');

    // Finalmente eliminar la tabla
    await queryInterface.dropTable('servicio_historicos');
  }
};