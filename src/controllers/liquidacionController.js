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
const { Op } = require("sequelize");
const { notificarGlobal } = require("../utils/notificar");

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
          attributes: ['id', 'nombre', 'apellido', 'sede_trabajo']
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
          attributes: ['id', 'dia', 'hora_inicio', 'hora_fin', 'total_horas', 'es_domingo', 'es_festivo', 'disponibilidad'],
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

    // Ordenar configuraciones para priorizar: primero sede específica, luego empresa específica, luego global
    const configuracionesOrdenadas = configuraciones.sort((a, b) => {
      const prioridad = (cfg) => {
        // Prioridad 3: sede + empresa, 2: sólo sede, 1: sólo empresa, 0: global
        if (cfg.sede && cfg.empresa_id) return 3;
        if (cfg.sede && !cfg.empresa_id) return 2;
        if (!cfg.sede && cfg.empresa_id) return 1;
        return 0;
      };
      return prioridad(b) - prioridad(a);
    });

    return configuracionesOrdenadas;
  } catch (error) {
    console.error('❌ Error obteniendo configuraciones de salario:', error);
    throw error;
  }
};

// ✅ FUNCIÓN MEJORADA: Procesar recargos con cálculo de valores usando configuración salarial
const procesarRecargosPorPeriodoConSalarios = async (recargos, periodoStart, periodoEnd, configuracionesSalario) => {
  try {
  return recargos.map(recargo => {
      // Selección priorizada de configuración salarial:
      // 1. Coincidencia por sede (case-insensitive) si el conductor tiene sede_trabajo y la config tiene sede.
      // 2. Coincidencia por empresa_id.
      // 3. Configuración global (empresa_id === null) como fallback.
      const sedeConductor = (recargo.conductor?.sede_trabajo || '').toLowerCase();
      let configSalario = null;
      let matchReason = 'no_match';
      // 1) sede + empresa
      configSalario = configuracionesSalario.find(
        (cfg) => cfg.sede && cfg.sede.toLowerCase() === sedeConductor && cfg.empresa_id === recargo.empresa.id
      );
      if (configSalario) {
        matchReason = 'sede+empresa';
      } else {
        // 2) solo sede (global por empresa)
        configSalario = configuracionesSalario.find(
          (cfg) => cfg.sede && cfg.sede.toLowerCase() === sedeConductor && !cfg.empresa_id
        );
        if (configSalario) {
          matchReason = 'solo_sede';
        } else {
          // 3) solo empresa (sin sede)
          configSalario = configuracionesSalario.find(
            (cfg) => cfg.empresa_id === recargo.empresa.id && !cfg.sede
          );
          if (configSalario) {
            matchReason = 'solo_empresa';
          } else {
            // 4) empresa con alguna sede
            configSalario = configuracionesSalario.find(
              (cfg) => cfg.empresa_id === recargo.empresa.id && cfg.sede
            );
            if (configSalario) {
              matchReason = 'empresa_con_sede_distinta';
            } else {
              // 5) global sin sede
              configSalario = configuracionesSalario.find(
                (cfg) => cfg.empresa_id === null && !cfg.sede
              );
              if (configSalario) {
                matchReason = 'global_sin_sede';
              } else {
                // 6) global con sede definida (raro)
                configSalario = configuracionesSalario.find((cfg) => cfg.empresa_id === null);
                if (configSalario) {
                  matchReason = 'global_con_sede';
                }
              }
            }
          }
        }
      }

      // Log estructurado de la configuración elegida para este recargo
      try {
        const logPayload = {
          scope: 'SALARIO_MATCH',
          contexto: 'procesarRecargosPorPeriodoConSalarios',
          periodo: { start: periodoStart, end: periodoEnd },
          conductor: {
            id: recargo.conductor?.id,
            nombre: `${recargo.conductor?.nombre || ''} ${recargo.conductor?.apellido || ''}`.trim(),
            sede_trabajo: recargo.conductor?.sede_trabajo || null,
          },
          empresa: { id: recargo.empresa?.id, nombre: recargo.empresa?.nombre },
          recargoPlanillaId: recargo.id,
          match_reason: matchReason,
          configuracion: configSalario
            ? {
                id: configSalario.id,
                empresa_id: configSalario.empresa_id,
                sede: configSalario.sede || null,
                vigencia_desde: configSalario.vigencia_desde || null,
                vigencia_hasta: configSalario.vigencia_hasta || null,
                valor_hora_trabajador: configSalario.valor_hora_trabajador || null,
                salario_basico: configSalario.salario_basico || null,
              }
            : null,
        };
        console.info(JSON.stringify(logPayload));
      } catch (_e) {
        // noop
      }

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
          if (configSalario && horas !== 0) {
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
          disponibilidad: dia.disponibilidad,
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

// Función para validar conceptos adicionales
const validarConceptosAdicionales = (conceptos) => {
  if (!conceptos) return true; // Es opcional
  
  if (!Array.isArray(conceptos)) {
    throw new Error("conceptos_adicionales debe ser un array");
  }
  
  if (conceptos.length > 20) {
    throw new Error("No se pueden agregar más de 20 conceptos adicionales por liquidación");
  }
  
  conceptos.forEach((concepto, index) => {
    // Validar valor
    if (typeof concepto.valor !== 'number') {
      throw new Error(`Concepto ${index + 1}: valor debe ser un número`);
    }
    
    if (concepto.valor === 0) {
      throw new Error(`Concepto ${index + 1}: valor no puede ser cero`);
    }
    
    if (Math.abs(concepto.valor) > 10000000) { // 10 millones
      throw new Error(`Concepto ${index + 1}: valor excede el límite permitido (10 millones)`);
    }
    
    // Validar observaciones
    if (!concepto.observaciones || typeof concepto.observaciones !== 'string') {
      throw new Error(`Concepto ${index + 1}: observaciones es requerido`);
    }
    
    if (concepto.observaciones.trim().length < 3) {
      throw new Error(`Concepto ${index + 1}: observaciones debe tener al menos 3 caracteres`);
    }
    
    if (concepto.observaciones.length > 500) {
      throw new Error(`Concepto ${index + 1}: observaciones no puede exceder 500 caracteres`);
    }
  });
  
  return true;
};

// Función para calcular el total de conceptos adicionales
const calcularTotalConceptosAdicionales = (conceptos) => {
  if (!conceptos || !Array.isArray(conceptos)) return 0;
  
  return conceptos.reduce((total, concepto) => {
    return total + (parseFloat(concepto.valor) || 0);
  }, 0);
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
      conceptos_adicionales = [], // Nuevo campo para conceptos adicionales
      salud,
      ajuste_parex,
      ajuste_salarial_por_dia,
      pension,
      cesantias,
      interes_cesantias,
      prima,
      estado,
    } = req.body;

    // Obtener el ID del usuario desde el contexto
    const usuario_id = req.user.id;

    // Validar conceptos adicionales
    try {
      validarConceptosAdicionales(conceptos_adicionales);
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError.message
      });
    }

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
        prima: prima || 0,
        estado,
        conceptos_adicionales,
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

    notificarGlobal("liquidacion:creada", {
      usuarioId: req.user.id,
      usuarioNombre: req.user.nombre,
      liquidacion: liquidacionConDetalles,
    });

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
      conceptos_adicionales = [], // Nuevo campo para conceptos adicionales
      salud,
      pension,
      cesantias,
      interes_cesantias,
      prima,
      estado,
    } = req.body;

    const usuario_id = req.user.id;

    // Validar conceptos adicionales
    try {
      validarConceptosAdicionales(conceptos_adicionales);
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError.message
      });
    }

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
        prima: prima || 0,
        estado,
        conceptos_adicionales,
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

    notificarGlobal("liquidacion:actualizada", {
      usuarioId: req.user.id,
      usuarioNombre: req.user.nombre,
      liquidacion: liquidacionActualizada,
    });

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

/**
 * Actualizar configuración
 * PUT /api/configuraciones/:id
 */
exports.actualizarConfiguracion = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, valor, tipo, activo } = req.body;

    // Validar que el ID sea válido
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "El ID de la configuración es obligatorio",
      });
    }

    // Buscar la configuración existente
    const configuracion = await ConfiguracionLiquidacion.findByPk(id);

    if (!configuracion) {
      return res.status(404).json({
        success: false,
        message: "Configuración no encontrada",
      });
    }

    // Si se está cambiando el nombre, verificar que no exista otro con el mismo nombre
    if (nombre && nombre.trim() !== configuracion.nombre) {
      const configuracionExistente = await ConfiguracionLiquidacion.findOne({
        where: {
          nombre: nombre.trim(),
          activo: true,
          id: { [Op.ne]: id } // Excluir la configuración actual
        }
      });

      if (configuracionExistente) {
        return res.status(409).json({
          success: false,
          message: "Ya existe otra configuración activa con ese nombre",
        });
      }
    }

    // Determinar el tipo a validar (nuevo tipo o tipo existente)
    const tipoParaValidar = tipo || configuracion.tipo;

    // Validar el valor si se está actualizando
    if (valor !== undefined) {
      const validationResult = validateValueByType(valor, tipoParaValidar);
      if (!validationResult.valid) {
        return res.status(400).json({
          success: false,
          message: validationResult.message,
        });
      }
    }

    // Preparar datos para actualizar (solo incluir campos que se enviaron)
    const updateData = {};
    
    if (nombre !== undefined && nombre.trim() !== '') {
      updateData.nombre = nombre.trim();
    }
    
    if (valor !== undefined) {
      updateData.valor = parseFloat(valor);
    }
    
    if (tipo !== undefined) {
      updateData.tipo = tipo;
    }
    
    if (activo !== undefined) {
      updateData.activo = Boolean(activo);
    }

    // Verificar que al menos un campo se esté actualizando
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No se enviaron datos para actualizar",
      });
    }

    // Actualizar la configuración
    await configuracion.update(updateData);

    // Obtener la configuración actualizada completa
    const configuracionActualizada = await ConfiguracionLiquidacion.findByPk(id);

    notificarGlobal("configuracion_liquidacion_actualizada", configuracionActualizada);

    res.status(200).json({
      success: true,
      message: "Configuración actualizada exitosamente",
      data: configuracionActualizada,
    });

  } catch (error) {
    console.error("Error al actualizar configuración:", error);
    
    // Manejar errores específicos de Sequelize
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: "Error de validación",
        errors: error.errors.map(e => ({
          field: e.path,
          message: e.message,
          value: e.value
        }))
      });
    }

    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        success: false,
        message: "Violación de restricción única",
        errors: error.errors.map(e => ({
          field: e.path,
          message: e.message
        }))
      });
    }

    if (error.name === 'SequelizeDatabaseError') {
      return res.status(500).json({
        success: false,
        message: "Error de base de datos",
        error: process.env.NODE_ENV === "development" ? error.message : "Error interno del servidor"
      });
    }

    // Error genérico
    res.status(500).json({
      success: false,
      message: "Error interno al actualizar la configuración",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Función auxiliar para validar valores según el tipo
 */
function validateValueByType(valor, tipo) {
  // Verificar que el valor sea numérico
  const numericValue = parseFloat(valor);
  
  if (isNaN(numericValue)) {
    return { 
      valid: false, 
      message: "El valor debe ser numérico válido" 
    };
  }

  // Validaciones específicas por tipo
  switch (tipo) {
    case 'PORCENTAJE':
      if (numericValue < 0 || numericValue > 100) {
        return { 
          valid: false, 
          message: "El porcentaje debe estar entre 0 y 100" 
        };
      }
      break;
    
    case 'VALOR_NUMERICO':
      if (numericValue < 0) {
        return { 
          valid: false, 
          message: "El valor numérico no puede ser negativo" 
        };
      }
      break;

    case 'MONTO_FIJO':
      if (numericValue < 0) {
        return { 
          valid: false, 
          message: "El monto fijo no puede ser negativo" 
        };
      }
      if (numericValue > 999999999.99) {
        return { 
          valid: false, 
          message: "El monto excede el límite máximo permitido" 
        };
      }
      break;
    
    case 'MULTIPLICADOR':
      if (numericValue <= 0) {
        return { 
          valid: false, 
          message: "El multiplicador debe ser mayor que 0" 
        };
      }
      if (numericValue > 1000) {
        return { 
          valid: false, 
          message: "El multiplicador no puede ser mayor a 1000" 
        };
      }
      break;
    
    case 'BOOLEAN':
      if (numericValue !== 0 && numericValue !== 1) {
        return { 
          valid: false, 
          message: "El valor booleano debe ser 0 (falso) o 1 (verdadero)" 
        };
      }
      break;
    
    case 'DESCUENTO':
      if (numericValue < 0) {
        return { 
          valid: false, 
          message: "El descuento no puede ser negativo" 
        };
      }
      if (numericValue > 100) {
        return { 
          valid: false, 
          message: "El descuento no puede ser mayor al 100%" 
        };
      }
      break;

    default:
      return { 
        valid: false, 
        message: `Tipo de valor no válido: ${tipo}` 
      };
  }

  return { valid: true };
}

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

    notificarGlobal("liquidacion:eliminada", {
      usuarioId: req.user.id,
      usuarioNombre: req.user.nombre,
      liquidacionId: id,
    });

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
exports.validarConceptosAdicionales = validarConceptosAdicionales;
exports.calcularTotalConceptosAdicionales = calcularTotalConceptosAdicionales;