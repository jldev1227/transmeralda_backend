const {
  Liquidacion,
  Conductor,
  User,
  Vehiculo,
  Bonificacion,
  Mantenimiento,
  Pernote,
  Recargo,
  Anticipo,
  Empresa,
  ConfiguracionLiquidacion,
  RecargoPlanilla,
  DiaLaboralPlanilla,
  DetalleRecargosDia,
  TipoRecargo,
  ConfiguracionSalario
} = require("../models");
const { Op } = require("sequelize")

// Obtener todas las liquidaciones
exports.obtenerLiquidaciones = async (req, res) => {
  try {
    const liquidaciones = await Liquidacion.findAll({
      include: [
        { model: Conductor, as: "conductor" },
        { model: Vehiculo, as: "vehiculos" },
        { model: Bonificacion, as: "bonificaciones" },
        { model: Mantenimiento, as: "mantenimientos" },
        { model: Pernote, as: "pernotes" },
        { model: Recargo, as: "recargos", include: [{ model: Empresa, as: "empresa" }] },
        { model: Anticipo, as: "anticipos" },
        {
          model: User,
          as: "creadoPor",
          attributes: ["id", "nombre", "correo"],
        },
        {
          model: User,
          as: "liquidadoPor",
          attributes: ["id", "nombre", "correo"],
        },
      ],
    });

    res.status(200).json({
      success: true,
      count: liquidaciones.length,
      data: liquidaciones,
    });
  } catch (error) {
    console.error("Error al obtener liquidaciones:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener liquidaciones",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Obtener una liquidación por ID
exports.obtenerLiquidacionPorId = async (req, res) => {
  try {
    const { id } = req.params;

    if (id === "configuracion") {
      return res.status(400).json({
        success: false,
        message: "Ruta no válida. Utilice /liquidaciones/configuracion en su lugar.",
      });
    }

    // ✅ PASO 1: Obtener la liquidación base
    const liquidacion = await Liquidacion.findByPk(id, {
      include: [
        { model: Conductor, as: "conductor" },
        { model: Vehiculo, as: "vehiculos" },
        {
          model: Mantenimiento,
          as: "mantenimientos",
          include: [
            {
              model: Vehiculo,
              as: "vehiculo",
              attributes: ["id", "placa", "modelo", "marca"],
              required: false,
            },
          ],
        },
        {
          model: Bonificacion,
          as: "bonificaciones",
          include: [
            {
              model: Vehiculo,
              as: "vehiculo",
              attributes: ["id", "placa", "modelo", "marca"],
              required: false,
            },
          ],
        },
        {
          model: Pernote,
          as: "pernotes",
          include: [
            {
              model: Vehiculo,
              as: "vehiculo",
              attributes: ["id", "placa", "modelo", "marca"],
              required: false,
            },
            {
              model: Empresa,
              as: "empresa",
              attributes: ["id", "nombre", "nit"],
              required: false,
            },
          ],
        },
        {
          model: Recargo,
          as: "recargos",
          include: [
            {
              model: Vehiculo,
              as: "vehiculo",
              attributes: ["id", "placa", "modelo", "marca"],
              required: false,
            },
            {
              model: Empresa,
              as: "empresa",
              attributes: ["id", "nombre", "nit"],
              required: false,
            },
          ],
        },
        { model: Anticipo, as: "anticipos" },
        {
          model: User,
          as: "creadoPor",
          attributes: ["id", "nombre", "correo"],
        },
        {
          model: User,
          as: "actualizadoPor",
          attributes: ["id", "nombre", "correo"],
        },
        {
          model: User,
          as: "liquidadoPor",
          attributes: ["id", "nombre", "correo"],
        },
      ],
      nest: true,
      raw: false,
    });

    if (!liquidacion) {
      return res.status(404).json({
        success: false,
        message: `Liquidación con ID ${id} no encontrada`,
      });
    }

    // ✅ PASO 2: Obtener configuraciones de salario
    const configuracionesSalario = await obtenerConfiguracionesSalario(liquidacion.periodo_start, liquidacion.periodo_end);

    // ✅ PASO 3: Obtener recargos planilla del conductor en el período
    const recargosDelPeriodo = await obtenerRecargosPlanillaPorPeriodo(
      liquidacion.conductor.id,
      liquidacion.periodo_start,
      liquidacion.periodo_end
    );

    // ✅ PASO 4: Procesar y filtrar días dentro del período con configuración salarial
    const recargosProcessados = await procesarRecargosPorPeriodoConSalarios(
      recargosDelPeriodo,
      liquidacion.periodo_start,
      liquidacion.periodo_end,
      configuracionesSalario
    );

    // ✅ PASO 5: Agregar los recargos planilla y configuraciones a la respuesta
    const liquidacionCompleta = {
      ...liquidacion.toJSON(),
      configuraciones_salario: configuracionesSalario,
      recargos_planilla: {
        periodo_start: liquidacion.periodo_start,
        periodo_end: liquidacion.periodo_end,
        total_recargos: recargosProcessados.length,
        total_dias_laborados: recargosProcessados.reduce((total, recargo) =>
          total + recargo.dias_laborales.length, 0),
        total_horas_trabajadas: recargosProcessados.reduce((total, recargo) =>
          total + (parseFloat(recargo.total_horas) || 0), 0),
        recargos: recargosProcessados
      }
    };

    res.status(200).json({
      success: true,
      data: liquidacionCompleta,
    });

  } catch (error) {
    console.error("❌ Error al obtener liquidación:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener liquidación",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const obtenerRecargosPlanillaPorPeriodo = async (conductorId, periodoStart, periodoEnd) => {
  try {

    // Convertir fechas de período a objetos Date para comparación
    const fechaInicio = new Date(periodoStart);
    const fechaFin = new Date(periodoEnd);

    // Extraer años y meses del período para optimizar la consulta
    const añoInicio = fechaInicio.getFullYear();
    const mesInicio = fechaInicio.getMonth() + 1;
    const añoFin = fechaFin.getFullYear();
    const mesFin = fechaFin.getMonth() + 1;
    // ✅ CONSTRUIR WHERE CLAUSE PARA AÑOS Y MESES
    const whereClause = {
      conductor_id: conductorId,
      [Op.or]: []
    };
    // Agregar condiciones para todos los meses del período
    for (let año = añoInicio; año <= añoFin; año++) {
      const mesInicial = año === añoInicio ? mesInicio : 1;
      const mesFinal = año === añoFin ? mesFin : 12;
      for (let mes = mesInicial; mes <= mesFinal; mes++) {
        whereClause[Op.or].push({
          año: año,
          mes: mes
        });
      }
    }
    // ✅ CONSULTA OPTIMIZADA SIMILAR A CANVAS
    const recargos = await RecargoPlanilla.findAll({
      where: whereClause,
      attributes: [
        'id', 'mes', 'año',
        'total_horas_trabajadas', 'total_dias_laborados',
        'created_at'
      ],
      include: [
        {
          model: Conductor,
          as: 'conductor',
          attributes: ['id', 'nombre', 'apellido']
        },
        {
          model: Vehiculo,
          as: 'vehiculo',
          attributes: ['id', 'placa']
        },
        {
          model: Empresa,
          as: 'empresa',
          attributes: ['id', 'nombre', 'nit']
        },
        {
          model: DiaLaboralPlanilla,
          as: 'dias_laborales',
          attributes: ['id', 'dia', 'hora_inicio', 'hora_fin', 'total_horas', 'es_domingo', 'es_festivo'],
          include: [
            {
              model: DetalleRecargosDia,
              as: 'detallesRecargos',
              attributes: ['id', 'horas'],
              include: [
                {
                  model: TipoRecargo,
                  as: 'tipoRecargo',
                  attributes: ['id', 'codigo', 'nombre', 'porcentaje', 'adicional']
                }
              ]
            }
          ],
          order: [['dia', 'ASC']]
        }
      ],
      order: [['año', 'DESC'], ['mes', 'DESC'], ['numero_planilla', 'ASC']],
      raw: false,
      nest: true
    });
    return recargos;
  } catch (error) {
    console.error('❌ Error obteniendo recargos planilla por período:', error);
    throw error;
  }
};

const obtenerConfiguracionesSalario = async (periodoStart, periodoEnd) => {
  try {
    const fechaInicio = new Date(periodoStart);
    const fechaFin = new Date(periodoEnd);

    const configuraciones = await ConfiguracionSalario.findAll({
      where: {
        activo: true,
        vigencia_desde: {
          [Op.lte]: fechaFin
        },
        [Op.or]: [
          { vigencia_hasta: null },
          { vigencia_hasta: { [Op.gte]: fechaInicio } }
        ]
      },
      include: [
        {
          model: Empresa,
          as: 'empresa',
          attributes: ['id', 'nombre', 'nit'],
          required: false
        }
      ],
      order: [['vigencia_desde', 'DESC'], ['empresa_id', 'ASC']],
      raw: false,
      nest: true
    });

    return configuraciones;
  } catch (error) {
    console.error('❌ Error obteniendo configuraciones de salario:', error);
    throw error;
  }
};

// ✅ FUNCIÓN MEJORADA: Procesar recargos con cálculo de valores usando configuración salarial
const procesarRecargosPorPeriodoConSalarios = async (recargos, periodoStart, periodoEnd, configuracionesSalario) => {
  try {
    return recargos.map(recargo => {
      const configSalario = configuracionesSalario.find(config =>
        config.empresa_id === recargo.empresa.id || config.empresa_id === null
      );

      // CORREGIDO: Filtrar días usando la misma lógica que el frontend
      const diasDentroDelPeriodo = recargo.dias_laborales?.filter(dia => {
        // Construir fecha completa del día (igual que en frontend)
        let fechaCompleta;

        // Si el día tiene fecha_completa, usarla
        if (dia.fecha_completa) {
          fechaCompleta = dia.fecha_completa;
        }
        // Si no, construir usando día.mes y día.año si están disponibles
        else if (dia.mes && dia.año && dia.dia) {
          const año = dia.año;
          const mes = dia.mes.toString().padStart(2, '0');
          const diaStr = dia.dia.toString().padStart(2, '0');
          fechaCompleta = `${año}-${mes}-${diaStr}`;
        }
        // Fallback: usar recargo.mes y recargo.año
        else {
          const año = recargo.año;
          const mes = recargo.mes.toString().padStart(2, '0');
          const diaStr = dia.dia.toString().padStart(2, '0');
          fechaCompleta = `${año}-${mes}-${diaStr}`;
        }

        // Comparación de strings (igual que en frontend)
        return fechaCompleta >= periodoStart && fechaCompleta <= periodoEnd;
      }) || [];

      // ✅ PROCESAR DÍAS CON CÁLCULO DE VALORES
      const diasProcesados = diasDentroDelPeriodo.map(dia => {
        const recargosDelDia = { hed: 0, hen: 0, hefd: 0, hefn: 0, rn: 0, rd: 0 };
        const tiposRecargosDelDia = [];

        dia.detallesRecargos?.forEach(detalle => {
          const codigo = detalle.tipoRecargo.codigo.toLowerCase();
          const horas = parseFloat(detalle.horas) || 0;
          recargosDelDia[codigo] = horas;

          // Calcular valor usando configuración salarial
          let valorCalculado = 0;
          if (configSalario && horas > 0) {
            const valorHora = parseFloat(configSalario.valor_hora_trabajador);
            const porcentaje = parseFloat(detalle.tipoRecargo.porcentaje) / 100;
            valorCalculado = valorHora * porcentaje * horas;
          }

          tiposRecargosDelDia.push({
            codigo: detalle.tipoRecargo.codigo,
            nombre: detalle.tipoRecargo.nombre,
            porcentaje: detalle.tipoRecargo.porcentaje,
            categoria: detalle.tipoRecargo.categoria,
            adicional: detalle.tipoRecargo.adicional,
            horas: horas,
            valor_calculado: valorCalculado
          });
        });

        return {
          id: dia.id,
          dia: dia.dia,
          mes: dia.mes || recargo.mes,        // ← ASEGURAR que tenga mes
          año: dia.año || recargo.año,        // ← ASEGURAR que tenga año
          fecha_completa: dia.fecha_completa ||
            `${dia.año || recargo.año}-${String(dia.mes || recargo.mes).padStart(2, '0')}-${String(dia.dia).padStart(2, '0')}`,
          hora_inicio: dia.hora_inicio,
          hora_fin: dia.hora_fin,
          total_horas: dia.total_horas,
          es_especial: dia.es_domingo || dia.es_festivo,
          es_domingo: dia.es_domingo,
          es_festivo: dia.es_festivo,
          ...recargosDelDia,
          tipos_recargos: tiposRecargosDelDia
        };
      });

      const totalHorasDelPeriodo = diasProcesados.reduce((total, dia) =>
        total + (parseFloat(dia.total_horas) || 0), 0);

      return {
        id: recargo.id,
        conductor: recargo.conductor,
        vehiculo: recargo.vehiculo,
        empresa: recargo.empresa,
        mes: recargo.mes,
        año: recargo.año,
        total_horas_original: recargo.total_horas_trabajadas,
        total_dias_original: recargo.total_dias_laborados,
        total_horas: totalHorasDelPeriodo,
        total_dias: diasProcesados.length,
        created_at: recargo.created_at,
        dias_laborales: diasProcesados
      };
    })
      .filter(recargo => recargo.dias_laborales.length > 0);

  } catch (error) {
    console.error('❌ Error procesando recargos por período con salarios:', error);
    throw error;
  }
};

// Crear liquidación con anticipos integrados
exports.crearLiquidacion = async (req, res) => {
  const transaction = await Liquidacion.sequelize.transaction();

  try {
    const {
      conductor_id,
      periodo_start,
      periodo_end,
      periodo_start_vacaciones,
      periodo_end_vacaciones,
      periodo_start_incapacidad,
      periodo_end_incapacidad,
      auxilio_transporte,
      sueldo_total,
      salario_devengado,
      total_pernotes,
      total_bonificaciones,
      total_recargos,
      total_anticipos,
      total_vacaciones,
      valor_incapacidad,
      dias_laborados,
      dias_incapacidad,
      dias_laborados_villanueva,
      dias_laborados_anual,
      ajuste_salarial,
      vehiculos,
      bonificaciones,
      mantenimientos,
      pernotes,
      recargos,
      anticipos, // Nuevo campo para los anticipos desde frontend
      salud,
      ajuste_parex,
      ajuste_salarial_por_dia,
      pension,
      cesantias,
      interes_cesantias,
      estado,
    } = req.body;

    // Obtener el ID del usuario desde el contexto
    const usuario_id = req.user.id;

    // Verificar si el conductor existe
    const conductor = await Conductor.findByPk(conductor_id, {
      attributes: ["id", "nombre", "apellido", "numero_identificacion"],
      transaction,
    });

    if (!conductor) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: `El conductor con ID ${conductor_id} no existe.`,
      });
    }

    // Verificar si los vehículos existen
    const vehiculosDB = await Vehiculo.findAll({
      where: { id: vehiculos },
      transaction,
    });

    if (vehiculosDB.length !== vehiculos.length) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Algunos vehículos no se encontraron.",
      });
    }

    // Calcular el total de anticipos si se envían desde el frontend
    let calculatedTotalAnticipos = 0;
    if (anticipos && anticipos.length > 0) {
      calculatedTotalAnticipos = anticipos.reduce(
        (total, anticipo) => total + (anticipo.valor || 0),
        0
      );
    }

    // Usar el total calculado o el enviado directamente
    const finalTotalAnticipos =
      calculatedTotalAnticipos || total_anticipos || 0;

    // Crear la nueva liquidación
    const nuevaLiquidacion = await Liquidacion.create(
      {
        conductor_id,
        periodo_start,
        periodo_end,
        periodo_start_vacaciones,
        periodo_end_vacaciones,
        auxilio_transporte,
        sueldo_total,
        salario_devengado,
        total_pernotes,
        total_bonificaciones,
        total_recargos,
        total_anticipos: finalTotalAnticipos, // Usar el total calculado
        total_vacaciones,
        dias_laborados,
        periodo_start_incapacidad,
        periodo_end_incapacidad,
        valor_incapacidad,
        ajuste_parex,
        ajuste_salarial_por_dia,
        dias_incapacidad,
        dias_laborados_villanueva,
        dias_laborados_anual,
        ajuste_salarial,
        salud,
        pension,
        cesantias,
        interes_cesantias,
        estado,
      },
      {
        transaction,
        user: { id: usuario_id }, // Añadir el usuario a las opciones
      }
    );

    // Asociar los vehículos a la liquidación
    await nuevaLiquidacion.setVehiculos(vehiculosDB, { transaction });

    // Insertar bonificaciones
    if (bonificaciones && bonificaciones.length > 0) {
      await Promise.all(
        bonificaciones.map((bono) =>
          Bonificacion.create(
            {
              liquidacion_id: nuevaLiquidacion.id,
              vehiculo_id: bono.vehiculoId,
              name: bono.name,
              values: bono.values,
              value: bono.value,
            },
            { transaction }
          )
        )
      );
    }

    // Insertar mantenimientos
    if (mantenimientos && mantenimientos.length > 0) {
      await Promise.all(
        mantenimientos.map((mantenimiento) =>
          Mantenimiento.create(
            {
              liquidacion_id: nuevaLiquidacion.id,
              vehiculo_id: mantenimiento.vehiculoId,
              values: mantenimiento.values,
              value: mantenimiento.value,
            },
            { transaction }
          )
        )
      );
    }

    // Insertar pernotes
    if (pernotes && pernotes.length > 0) {
      await Promise.all(
        pernotes.map((pernote) =>
          Pernote.create(
            {
              liquidacion_id: nuevaLiquidacion.id,
              vehiculo_id: pernote.vehiculoId,
              empresa_id: pernote.empresa_id,
              cantidad: pernote.cantidad,
              valor: pernote.valor,
              fechas: pernote.fechas,
            },
            { transaction }
          )
        )
      );
    }

    // Insertar recargos
    if (recargos && recargos.length > 0) {
      await Promise.all(
        recargos.map((recargo) =>
          Recargo.create(
            {
              liquidacion_id: nuevaLiquidacion.id,
              vehiculo_id: recargo.vehiculoId,
              empresa_id: recargo.empresa_id,
              valor: recargo.valor,
              pag_cliente: recargo.pag_cliente,
              mes: recargo.mes,
            },
            { transaction }
          )
        )
      );
    }

    // Insertar anticipos
    if (anticipos && anticipos.length > 0) {
      await Promise.all(
        anticipos.map((anticipo) =>
          Anticipo.create(
            {
              liquidacion_id: nuevaLiquidacion.id,
              valor: anticipo.valor,
              fecha: anticipo.fecha,
              // Otros campos que pueda tener tu modelo Anticipo
            },
            { transaction }
          )
        )
      );
    }

    // Confirmar transacción
    await transaction.commit();

    // Consultar la liquidación con todas las relaciones
    const liquidacionConDetalles = await Liquidacion.findByPk(
      nuevaLiquidacion.id,
      {
        include: [
          { model: Conductor, as: "conductor" },
          { model: Vehiculo, as: "vehiculos" },
          { model: Bonificacion, as: "bonificaciones" },
          { model: Mantenimiento, as: "mantenimientos" },
          { model: Pernote, as: "pernotes" },
          { model: Recargo, as: "recargos" },
          { model: Anticipo, as: "anticipos" },
        ],
      }
    );

    // Emisión de evento Socket.IO para notificar a los clientes
    const emitLiquidacionEvent = req.app.get("emitLiquidacionEvent");

    if (emitLiquidacionEvent) {
      // Emitir evento global
      emitLiquidacionEvent("liquidacion_creada", {
        liquidacion: liquidacionConDetalles, // Usar la variable correcta
        usuarioCreador: req.user?.nombre || "Sistema",
      });
    }

    res.status(201).json({
      success: true,
      data: liquidacionConDetalles,
    });
  } catch (error) {
    // Solo intentar hacer rollback si la transacción aún no ha sido completada
    if (!transaction.finished) {
      await transaction.rollback();
    }

    console.error("Error al crear la liquidación:", error);
    res.status(500).json({
      success: false,
      message: "Error creando la liquidación",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Editar una liquidación existente
exports.editarLiquidacion = async (req, res) => {
  const transaction = await Liquidacion.sequelize.transaction();

  try {
    const { id } = req.params;
    const {
      conductor_id,
      periodo_start,
      periodo_end,
      periodo_start_vacaciones,
      periodo_end_vacaciones,
      auxilio_transporte,
      sueldo_total,
      salario_devengado,
      total_pernotes,
      total_bonificaciones,
      total_recargos,
      total_anticipos,
      total_vacaciones,
      dias_laborados,
      dias_laborados_villanueva,
      dias_laborados_anual,
      periodo_start_incapacidad,
      periodo_end_incapacidad,
      valor_incapacidad,
      ajuste_parex,
      ajuste_salarial_por_dia,
      dias_incapacidad,
      ajuste_salarial,
      vehiculos,
      bonificaciones,
      mantenimientos,
      pernotes,
      recargos,
      anticipos, // Puede venir vacío o undefined cuando se eliminan todos los anticipos
      salud,
      pension,
      cesantias,
      interes_cesantias,
      estado,
    } = req.body;

    const usuario_id = req.user.id;

    // Buscar la liquidación existente
    const liquidacion = await Liquidacion.findByPk(id, { transaction });

    if (!liquidacion) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Liquidación no encontrada",
      });
    }

    // Calcular el total de anticipos si se envían desde el frontend
    let calculatedTotalAnticipos = 0;
    if (anticipos && anticipos.length > 0) {
      calculatedTotalAnticipos = anticipos.reduce(
        (total, anticipo) => total + (anticipo.valor || 0),
        0
      );
    }

    // Usar el total calculado o el enviado directamente
    const finalTotalAnticipos =
      calculatedTotalAnticipos || total_anticipos || 0;

    // Actualizar campos de la liquidación
    await liquidacion.update(
      {
        conductor_id: conductor_id || liquidacion.conductor_id,
        periodo_start,
        periodo_end,
        auxilio_transporte,
        sueldo_total,
        salario_devengado,
        total_pernotes,
        total_bonificaciones,
        total_recargos,
        total_anticipos: finalTotalAnticipos, // Usar el total calculado
        total_vacaciones,
        periodo_start_vacaciones,
        periodo_end_vacaciones,
        dias_laborados,
        periodo_start_incapacidad,
        periodo_end_incapacidad,
        valor_incapacidad,
        dias_incapacidad,
        ajuste_parex,
        ajuste_salarial_por_dia,
        dias_laborados_villanueva,
        dias_laborados_anual,
        ajuste_salarial,
        salud,
        pension,
        cesantias,
        interes_cesantias,
        estado,
      },
      {
        transaction,
        user: { id: usuario_id }, // Añadir el usuario a las opciones
      }
    );

    // Actualizar vehículos
    if (vehiculos && vehiculos.length > 0) {
      const vehiculosDB = await Vehiculo.findAll({
        where: { id: vehiculos },
        transaction,
      });
      await liquidacion.setVehiculos(vehiculosDB, { transaction });
    }

    // Actualizar bonificaciones
    if (bonificaciones && bonificaciones.length > 0) {
      // Eliminar bonificaciones existentes
      await Bonificacion.destroy({
        where: { liquidacion_id: id },
        transaction,
      });

      // Crear nuevas bonificaciones
      await Promise.all(
        bonificaciones.map((bono) =>
          Bonificacion.create(
            {
              liquidacion_id: id,
              vehiculo_id: bono.vehiculoId,
              name: bono.name,
              values: bono.values,
              value: bono.value,
            },
            { transaction }
          )
        )
      );
    }

    // Actualizar mantenimientos
    if (mantenimientos && mantenimientos.length > 0) {
      await Mantenimiento.destroy({
        where: { liquidacion_id: id },
        transaction,
      });

      await Promise.all(
        mantenimientos.map((mantenimiento) =>
          Mantenimiento.create(
            {
              liquidacion_id: id,
              vehiculo_id: mantenimiento.vehiculoId,
              values: mantenimiento.values,
              value: mantenimiento.value,
            },
            { transaction }
          )
        )
      );
    }

    // Actualizar pernotes
    if (pernotes && pernotes.length > 0) {
      await Pernote.destroy({
        where: { liquidacion_id: id },
        transaction,
      });

      await Promise.all(
        pernotes.map((pernote) =>
          Pernote.create(
            {
              liquidacion_id: id,
              vehiculo_id: pernote.vehiculoId,
              empresa_id: pernote.empresa_id,
              cantidad: pernote.cantidad,
              valor: pernote.valor,
              fechas: pernote.fechas,
            },
            { transaction }
          )
        )
      );
    }

    // Actualizar recargos
    if (recargos && recargos.length > 0) {
      await Recargo.destroy({
        where: { liquidacion_id: id },
        transaction,
      });

      await Promise.all(
        recargos.map((recargo) =>
          Recargo.create(
            {
              liquidacion_id: id,
              vehiculo_id: recargo.vehiculoId,
              empresa_id: recargo.empresa_id,
              valor: recargo.valor,
              pag_cliente: recargo.pag_cliente,
              mes: recargo.mes,
            },
            { transaction }
          )
        )
      );
    }

    // Manejar anticipos - MODIFICADO
    // Siempre eliminar los anticipos existentes
    await Anticipo.destroy({
      where: { liquidacion_id: id },
      transaction,
    });

    // Solo crear nuevos anticipos si el array no está vacío
    if (anticipos && anticipos.length > 0) {
      // Crear nuevos anticipos
      await Promise.all(
        anticipos.map((anticipo) =>
          Anticipo.create(
            {
              liquidacion_id: id,
              valor: anticipo.valor,
              fecha: anticipo.fecha,
              // Otros campos que pueda tener tu modelo Anticipo
            },
            { transaction }
          )
        )
      );
    }

    // Confirmar transacción
    await transaction.commit();

    // Obtener liquidación actualizada con todas las relaciones
    const liquidacionActualizada = await Liquidacion.findByPk(id, {
      include: [
        { model: Conductor, as: "conductor" },
        { model: Vehiculo, as: "vehiculos" },
        { model: Bonificacion, as: "bonificaciones" },
        { model: Mantenimiento, as: "mantenimientos" },
        { model: Pernote, as: "pernotes" },
        { model: Recargo, as: "recargos" },
        { model: Anticipo, as: "anticipos" },
      ],
    });

    const emitLiquidacionEvent = req.app.get("emitLiquidacionEvent");

    if (emitLiquidacionEvent) {
      // Emitir evento global
      emitLiquidacionEvent("liquidacion_actualizada", {
        liquidacion: liquidacionActualizada, // Usar la variable correcta
        usuarioActualizador: req.user?.nombre || "Sistema",
      });
    }

    res.status(200).json({
      success: true,
      data: liquidacionActualizada,
    });
  } catch (error) {
    // Solo intentar hacer rollback si la transacción aún no ha sido completada
    if (!transaction.finished) {
      await transaction.rollback();
    }
    console.error("Error al actualizar la liquidación:", error);
    res.status(500).json({
      success: false,
      message: "Error actualizando la liquidación",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.obtenerConfiguracion = async (req, res) => {
  try {
    const configuraciones = await ConfiguracionLiquidacion.findAll();

    res.status(200).json({
      success: true,
      count: configuraciones.length,
      data: configuraciones,
    });
  } catch (error) {
    console.error("Error al obtener configuraciones:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener configuraciones",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.eliminarLiquidacion = async (req, res) => {
  const { id } = req.params;
  try {
    // Buscar la liquidación para verificar que existe
    const liquidacion = await Liquidacion.findByPk(id);

    if (!liquidacion) {
      throw new Error(`No se encontró la liquidación con ID: ${id}`);
    }

    // Eliminar la liquidación - las relaciones se eliminarán automáticamente por CASCADE
    await liquidacion.destroy();

    const emitLiquidacionEvent = req.app.get("emitLiquidacionEvent");

    if (emitLiquidacionEvent) {
      // Emitir evento global
      emitLiquidacionEvent("liquidacion_eliminada", {
        liquidacionId: id,
      });
    }

    res.status(200).json({
      success: true,
      message: "Liquidación eliminada correctamente",
      id: id,
    });
  } catch (error) {
    console.error("Error al eliminar liquidacion:", error);
    res.status(500).json({
      success: false,
      message: "Error al eliminar liquidacion",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};


exports.obtenerConfiguracionesSalario = obtenerConfiguracionesSalario;
exports.obtenerRecargosPlanillaPorPeriodo = obtenerRecargosPlanillaPorPeriodo;
exports.procesarRecargosPorPeriodoConSalarios = procesarRecargosPorPeriodoConSalarios;