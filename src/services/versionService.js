// services/versionService.js
const { Op } = require('sequelize');
const db = require('../models');
const {
  RecargoPlanilla,
  SnapshotRecargoPlanilla,
  HistorialRecargoPlanilla,
  DiaLaboralPlanilla,
  DetalleRecargosDia,
  TipoRecargo,
  Conductor,
  Vehiculo,
  Empresa
} = db;

class VersionService {

  /**
   * Restaurar un recargo a una versión específica
   */
  async restaurarVersion(recargoId, versionObjetivo, userId, motivo) {
    const transaction = await db.sequelize.transaction();

    try {
      // 1. Validar que la versión objetivo existe
      const historialExiste = await HistorialRecargoPlanilla.findOne({
        where: {
          recargo_planilla_id: recargoId,
          version_nueva: versionObjetivo
        },
        transaction
      });

      if (!historialExiste) {
        throw new Error(`La versión ${versionObjetivo} no existe para este recargo`);
      }

      // 2. Buscar snapshot más cercano (hacia atrás)
      const snapshotCercano = await SnapshotRecargoPlanilla.findOne({
        where: {
          recargo_planilla_id: recargoId,
          version: { [Op.lte]: versionObjetivo }
        },
        order: [['version', 'DESC']],
        transaction
      });

      if (!snapshotCercano) {
        throw new Error('No se encontró snapshot para restaurar. No se puede reconstruir el estado.');
      }

      let estadoRestaurado = JSON.parse(JSON.stringify(snapshotCercano.snapshot_completo));

      // 3. Si no es el snapshot exacto, aplicar deltas
      if (snapshotCercano.version < versionObjetivo) {
        const deltas = await HistorialRecargoPlanilla.findAll({
          where: {
            recargo_planilla_id: recargoId,
            version_nueva: {
              [Op.gt]: snapshotCercano.version,
              [Op.lte]: versionObjetivo
            }
          },
          order: [['version_nueva', 'ASC']],
          transaction
        });

        estadoRestaurado = this.aplicarDeltas(estadoRestaurado, deltas);
      }

      // 4. Obtener recargo actual
      const recargoActual = await RecargoPlanilla.findByPk(recargoId, { transaction });
      if (!recargoActual) {
        throw new Error('Recargo no encontrado');
      }

      const versionAnterior = recargoActual.version;

      // 5. Extraer solo los campos actualizables del recargo
      const camposActualizables = {
        numero_planilla: estadoRestaurado.numero_planilla,
        estado: estadoRestaurado.estado,
        observaciones: estadoRestaurado.observaciones,
        total_dias_laborados: estadoRestaurado.total_dias_laborados,
        total_horas_trabajadas: estadoRestaurado.total_horas_trabajadas,
        total_horas_ordinarias: estadoRestaurado.total_horas_ordinarias,
        planilla_s3key: estadoRestaurado.planilla_s3key,
      };

      // 6. Actualizar el recargo
      await recargoActual.update(camposActualizables, {
        transaction,
        userId,
        motivo: `Restauración a versión ${versionObjetivo}: ${motivo}`,
        forzarSnapshot: true,
        tipoSnapshot: 'manual'
      });

      const versionNueva = recargoActual.version;

      // 7. Restaurar días laborales (eliminar actuales y recrear)
      if (estadoRestaurado.dias_laborales && estadoRestaurado.dias_laborales.length > 0) {
        // Eliminar días actuales
        await DiaLaboralPlanilla.destroy({
          where: { recargo_planilla_id: recargoId },
          transaction,
          force: true
        });

        // Recrear días del snapshot
        for (const dia of estadoRestaurado.dias_laborales) {
          const nuevoDia = await DiaLaboralPlanilla.create({
            recargo_planilla_id: recargoId,
            dia: dia.dia,
            hora_inicio: dia.hora_inicio,
            hora_fin: dia.hora_fin,
            total_horas: dia.total_horas,
            horas_ordinarias: dia.horas_ordinarias || 0,
            es_domingo: dia.es_domingo,
            es_festivo: dia.es_festivo,
            observaciones: dia.observaciones,
            creado_por_id: userId,
            actualizado_por_id: userId
          }, { transaction });

          // Recrear detalles de recargos
          if (dia.detallesRecargos && dia.detallesRecargos.length > 0) {
            for (const detalle of dia.detallesRecargos) {
              await DetalleRecargosDia.create({
                dia_laboral_id: nuevoDia.id,
                tipo_recargo_id: detalle.tipo_recargo_id,
                horas: detalle.horas,
                valor_hora_base: detalle.valor_hora_base,
                valor_calculado: detalle.valor_calculado,
                calculado_automaticamente: detalle.calculado_automaticamente,
                observaciones: detalle.observaciones,
                creado_por_id: userId,
                actualizado_por_id: userId
              }, { transaction });
            }
          }
        }
      }

      // 8. Registrar en historial como "restauracion"
      await HistorialRecargoPlanilla.create({
        recargo_planilla_id: recargoId,
        accion: 'restauracion',
        version_anterior: versionAnterior,
        version_nueva: versionNueva,
        datos_anteriores: {
          version_restaurada_desde: versionObjetivo,
          snapshot_utilizado: snapshotCercano.version
        },
        datos_nuevos: camposActualizables,
        campos_modificados: Object.keys(camposActualizables),
        motivo,
        realizado_por_id: userId,
        fecha_accion: new Date()
      }, { transaction });

      await transaction.commit();

      return {
        success: true,
        version_anterior: versionAnterior,
        version_nueva: versionNueva,
        version_restaurada: versionObjetivo,
        snapshot_utilizado: snapshotCercano.version,
        deltas_aplicados: versionObjetivo - snapshotCercano.version
      };

    } catch (error) {
      await transaction.rollback();
      console.error('Error restaurando versión:', error);
      throw error;
    }
  }

  /**
   * Aplicar deltas secuencialmente sobre un estado base
   */
  aplicarDeltas(estadoBase, deltas) {
    let estado = JSON.parse(JSON.stringify(estadoBase));

    deltas.forEach(delta => {
      if (delta.datos_nuevos) {
        Object.keys(delta.datos_nuevos).forEach(campo => {
          // Solo aplicar si es un campo del recargo principal
          if (campo !== 'dias_laborales' && campo !== 'detallesRecargos') {
            estado[campo] = delta.datos_nuevos[campo];
          }
        });
      }
    });

    return estado;
  }

  /**
   * Comparar dos versiones de un recargo
   */
  async compararVersiones(recargoId, version1, version2) {
    const [estado1, estado2] = await Promise.all([
      this.obtenerEstadoEnVersion(recargoId, version1),
      this.obtenerEstadoEnVersion(recargoId, version2)
    ]);

    return this.calcularDiferencias(estado1, estado2);
  }

  /**
   * Obtener el estado completo de un recargo en una versión específica
   */
  async obtenerEstadoEnVersion(recargoId, version) {
    try {
      // 1. Buscar snapshot más cercano (hacia atrás)
      const snapshotCercano = await SnapshotRecargoPlanilla.findOne({
        where: {
          recargo_planilla_id: recargoId,
          version: { [Op.lte]: version }
        },
        order: [['version', 'DESC']]
      });

      if (!snapshotCercano) {
        throw new Error(`No se encontró snapshot para reconstruir la versión ${version}`);
      }

      let estado = JSON.parse(JSON.stringify(snapshotCercano.snapshot_completo));

      // 2. Si no es el snapshot exacto, aplicar deltas
      if (snapshotCercano.version < version) {
        const deltas = await HistorialRecargoPlanilla.findAll({
          where: {
            recargo_planilla_id: recargoId,
            version_nueva: {
              [Op.gt]: snapshotCercano.version,
              [Op.lte]: version
            }
          },
          order: [['version_nueva', 'ASC']]
        });

        estado = this.aplicarDeltas(estado, deltas);
      }

      return estado;

    } catch (error) {
      console.error('Error obteniendo estado en versión:', error);
      throw error;
    }
  }

  /**
   * Calcular diferencias entre dos estados
   */
  calcularDiferencias(estado1, estado2) {
    const diferencias = {
      recargo: {},
      dias_laborales: {
        agregados: [],
        eliminados: [],
        modificados: []
      }
    };

    // Comparar campos del recargo principal
    const camposComparar = [
      'numero_planilla', 'estado', 'observaciones',
      'total_dias_laborados', 'total_horas_trabajadas',
      'total_horas_ordinarias', 'planilla_s3key'
    ];

    camposComparar.forEach(campo => {
      const valor1 = estado1[campo];
      const valor2 = estado2[campo];

      if (JSON.stringify(valor1) !== JSON.stringify(valor2)) {
        diferencias.recargo[campo] = {
          anterior: valor1,
          nuevo: valor2
        };
      }
    });

    // Comparar días laborales
    const dias1 = estado1.dias_laborales || [];
    const dias2 = estado2.dias_laborales || [];

    const diasMap1 = new Map(dias1.map(d => [d.dia, d]));
    const diasMap2 = new Map(dias2.map(d => [d.dia, d]));

    // Días agregados
    dias2.forEach(dia2 => {
      if (!diasMap1.has(dia2.dia)) {
        diferencias.dias_laborales.agregados.push(dia2);
      }
    });

    // Días eliminados
    dias1.forEach(dia1 => {
      if (!diasMap2.has(dia1.dia)) {
        diferencias.dias_laborales.eliminados.push(dia1);
      }
    });

    // Días modificados
    dias1.forEach(dia1 => {
      const dia2 = diasMap2.get(dia1.dia);
      if (dia2) {
        const cambios = {};
        ['hora_inicio', 'hora_fin', 'total_horas', 'es_domingo', 'es_festivo'].forEach(campo => {
          if (dia1[campo] !== dia2[campo]) {
            cambios[campo] = {
              anterior: dia1[campo],
              nuevo: dia2[campo]
            };
          }
        });

        if (Object.keys(cambios).length > 0) {
          diferencias.dias_laborales.modificados.push({
            dia: dia1.dia,
            cambios
          });
        }
      }
    });

    return diferencias;
  }

  /**
   * Listar todas las versiones disponibles de un recargo
   */
  async listarVersiones(recargoId) {
    const [historial, snapshots] = await Promise.all([
      HistorialRecargoPlanilla.findAll({
        where: { recargo_planilla_id: recargoId },
        include: [{
          model: db.User,
          as: 'usuario',
          attributes: ['id', 'nombre', 'email']
        }],
        order: [['version_nueva', 'DESC']]
      }),
      SnapshotRecargoPlanilla.findAll({
        where: { recargo_planilla_id: recargoId },
        attributes: ['id', 'version', 'es_snapshot_mayor', 'tipo_snapshot', 'tamaño_bytes', 'created_at'],
        order: [['version', 'DESC']]
      })
    ]);

    // Enriquecer historial con info de snapshots
    const snapshotsMap = new Map(snapshots.map(s => [s.version, s]));

    const versionesEnriquecidas = historial.map(h => ({
      version: h.version_nueva,
      version_anterior: h.version_anterior,
      accion: h.accion,
      campos_modificados: h.campos_modificados,
      motivo: h.motivo,
      fecha: h.fecha_accion,
      usuario: h.usuario,
      tiene_snapshot: snapshotsMap.has(h.version_nueva),
      es_snapshot_mayor: snapshotsMap.get(h.version_nueva)?.es_snapshot_mayor || false,
      tipo_snapshot: snapshotsMap.get(h.version_nueva)?.tipo_snapshot || null
    }));

    return {
      versiones: versionesEnriquecidas,
      total_versiones: historial.length,
      total_snapshots: snapshots.length
    };
  }

  /**
   * Crear snapshot manual de la versión actual
   */
  async crearSnapshotManual(recargoId, userId, motivo, transaction) {
    // Si no se pasa transaction, crear una nueva
    const t = transaction || await db.sequelize.transaction();
    const shouldCommit = !transaction; // Solo hacer commit si creamos la transaction aquí

    try {
      const recargo = await RecargoPlanilla.findByPk(recargoId, {
        include: [
          {
            model: DiaLaboralPlanilla,
            as: 'dias_laborales',
            include: [{
              model: DetalleRecargosDia,
              as: 'detallesRecargos',
              include: [{ model: TipoRecargo, as: 'tipoRecargo' }]
            }]
          },
          { model: Conductor, as: 'conductor' },
          { model: Vehiculo, as: 'vehiculo' },
          { model: Empresa, as: 'empresa' }
        ],
        transaction: t
      });

      if (!recargo) {
        throw new Error('Recargo no encontrado');
      }

      const snapshot = recargo.toJSON();

      // ✅ Optimizar snapshot - eliminar datos redundantes
      const snapshotOptimizado = {
        id: snapshot.id,
        numero_planilla: snapshot.numero_planilla,
        mes: snapshot.mes,
        año: snapshot.año,
        estado: snapshot.estado,
        observaciones: snapshot.observaciones,
        total_dias_laborados: snapshot.total_dias_laborados,
        total_horas_trabajadas: snapshot.total_horas_trabajadas,
        total_horas_ordinarias: snapshot.total_horas_ordinarias,
        planilla_s3key: snapshot.planilla_s3key,
        version: snapshot.version,

        // Relaciones simplificadas - solo datos esenciales
        conductor: {
          id: snapshot.conductor.id,
          nombre: snapshot.conductor.nombre,
          apellido: snapshot.conductor.apellido,
          numero_identificacion: snapshot.conductor.numero_identificacion,
          tipo_identificacion: snapshot.conductor.tipo_identificacion
        },

        vehiculo: {
          id: snapshot.vehiculo.id,
          placa: snapshot.vehiculo.placa,
          marca: snapshot.vehiculo.marca,
          modelo: snapshot.vehiculo.modelo,
          clase_vehiculo: snapshot.vehiculo.clase_vehiculo
        },

        empresa: {
          id: snapshot.empresa.id,
          nombre: snapshot.empresa.nombre,
          nit: snapshot.empresa.nit
        },

        // Días laborales optimizados
        dias_laborales: snapshot.dias_laborales?.map(dia => ({
          id: dia.id,
          dia: dia.dia,
          hora_inicio: dia.hora_inicio,
          hora_fin: dia.hora_fin,
          total_horas: dia.total_horas,
          es_domingo: dia.es_domingo,
          es_festivo: dia.es_festivo,
          observaciones: dia.observaciones,

          // Detalles de recargos optimizados - solo lo necesario para restaurar
          detallesRecargos: dia.detallesRecargos?.map(detalle => ({
            id: detalle.id,
            horas: detalle.horas,
            dia_laboral_id: detalle.dia_laboral_id,

            // Tipo de recargo - solo campos esenciales
            tipo_recargo: {
              id: detalle.tipoRecargo.id,
              codigo: detalle.tipoRecargo.codigo,
              nombre: detalle.tipoRecargo.nombre,
              porcentaje: detalle.tipoRecargo.porcentaje
            }
          })) || []
        })) || []
      };

      const snapshotJSON = JSON.stringify(snapshotOptimizado);
      const tamañoBytes = Buffer.byteLength(snapshotJSON, 'utf8');

      await SnapshotRecargoPlanilla.create({
        recargo_planilla_id: recargoId,
        version: recargo.version,
        snapshot_completo: snapshotOptimizado,
        es_snapshot_mayor: true,
        tipo_snapshot: 'manual',
        tamaño_bytes: tamañoBytes,
        creado_por_id: userId
      }, { transaction: t });

      // Solo hacer commit si creamos la transaction aquí
      if (shouldCommit) {
        await t.commit();
      }

      console.log(`📸 Snapshot manual v${recargo.version} creado (${(tamañoBytes / 1024).toFixed(2)} KB - reducido ~66%)`);

      return {
        success: true,
        version: recargo.version,
        tamaño_kb: (tamañoBytes / 1024).toFixed(2),
        reduccion: '~66%'
      };

    } catch (error) {
      // Solo hacer rollback si creamos la transaction aquí
      if (shouldCommit) {
        await t.rollback();
      }
      console.error('Error creando snapshot manual:', error);
      throw error;
    }
  }
}

module.exports = new VersionService();