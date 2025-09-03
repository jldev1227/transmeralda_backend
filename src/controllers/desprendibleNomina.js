// controllers/desprendibleNomina.js
const Queue = require("bull");
const { v4: uuidv4 } = require("uuid");
const {
  Liquidacion,
  Conductor,
  Bonificacion,
  Pernote,
  Recargo,
  Anticipo,
} = require("../models");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
const path = require("path");
const { procesarRecargosPorPeriodoConSalarios, obtenerRecargosPlanillaPorPeriodo, obtenerConfiguracionesSalario } = require("./liquidacionController");

/**
 * Función para notificar al usuario a través de Socket.IO
 * @param {string} userId - ID del usuario
 * @param {string} event - Nombre del evento
 * @param {Object} data - Datos a enviar
 */
function notifyUser(userId, event, data) {
  try {
    // Obtener la función notifyUser de la aplicación global
    const notifyFn = global.app?.get("notifyUser");

    if (notifyFn) {
      notifyFn(userId, event, data);
    } else {
      console.log(
        `No se pudo notificar al usuario ${userId} (evento: ${event}) - Socket.IO no está disponible`
      );
    }
  } catch (error) {
    console.error("Error al notificar al usuario:", error);
  }
}

/**
 * Función para actualizar el progreso de un trabajo
 * @param {string} jobId - ID del trabajo
 * @param {number} progress - Progreso (0-100)
 * @param {string} userId - ID del usuario
 */
function updateJobProgress(jobId, progress, userId) {
  const job = activeJobs.get(jobId);
  if (!job) return;

  job.progress = progress;

  // Notificar al usuario sobre el progreso
  try {
    const notifyFn = global.app?.get("notifyUser");
    if (notifyFn) {
      notifyFn(userId, "job:progress", {
        jobId,
        progress,
      });
    }
  } catch (error) {
    console.error("Error al notificar progreso:", error);
  }
}

// Crear colas de tareas con Bull
const pdfQueue = new Queue("pdf-generation", {
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD
  },
});

const emailQueue = new Queue("email-sending", {
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD
  },
});

/**
 * Función para generar un PDF de respaldo simple
 * @param {string} filename - Nombre del archivo
 * @returns {Promise<Buffer>} - Buffer del PDF generado
 */
async function generateFallbackPDF(filename) {
  return new Promise((resolve) => {
    const chunks = [];
    const doc = new PDFDocument();

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer);
    });

    doc
      .fontSize(16)
      .text("Documento de respaldo", { align: "center" })
      .moveDown()
      .fontSize(12)
      .text(`Archivo original: ${filename}`)
      .text(`Generado: ${new Date().toLocaleString()}`);

    doc.end();
  });
}

// Registro de trabajos activos
const activeJobs = new Map();

/**
 * Controlador para generar PDFs y enviar correos electrónicos
 */
exports.generatePDFs = async (req, res) => {
  try {
    const { liquidacionIds, emailConfig } = req.body;

    if (
      !liquidacionIds ||
      !Array.isArray(liquidacionIds) ||
      liquidacionIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Se requiere al menos una liquidación para procesar",
      });
    }

    // Obtener el ID de usuario
    const userId = req.user?.id;

    // Crear un ID único para el trabajo
    const jobId = uuidv4();

    // Inicializar el estado del trabajo
    activeJobs.set(jobId, {
      userId,
      status: "queued",
      progress: 0,
      startTime: new Date(),
      liquidacionIds,
      totalEmails: liquidacionIds.length,
      error: null,
    });

    // Agregar trabajo a la cola de generación de PDFs
    await pdfQueue.add(
      {
        jobId,
        userId,
        liquidacionIds,
        emailConfig,
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000, // 5 segundos de retraso inicial
        },
      }
    );

    // Devolver respuesta inmediata con el ID del trabajo
    res.status(202).json({
      success: true,
      message: "Proceso de generación y envío iniciado",
      jobId,
    });
  } catch (error) {
    console.error("Error al iniciar generación de PDFs:", error);
    res.status(500).json({
      success: false,
      message: "Error al iniciar el proceso",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Controlador para verificar el estado de un trabajo
 */
exports.checkJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId || !activeJobs.has(jobId)) {
      return res.status(404).json({
        success: false,
        message: "Trabajo no encontrado",
      });
    }

    const job = activeJobs.get(jobId);

    // Verificar que el trabajo pertenece al usuario (seguridad)
    if (job.userId !== req.user?.id) {
      return res.status(403).json({
        success: false,
        message: "No tiene permiso para acceder a este trabajo",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        jobId,
        status: job.status,
        progress: job.progress,
        startTime: job.startTime,
        totalEmails: job.totalEmails,
        ...(job.completedTime && { completedTime: job.completedTime }),
        ...(job.error && { error: job.error }),
      },
    });
  } catch (error) {
    console.error("Error al consultar estado del trabajo:", error);
    res.status(500).json({
      success: false,
      message: "Error al consultar estado del trabajo",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const getMesyAño = (dateStr) => {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    return date
      .toLocaleDateString("es-CO", {
        month: "long",
        year: "numeric",
      })
      .toUpperCase();
  } catch (e) {
    console.error("Error formatting date:", e);
    return "";
  }
};

// Manejador para la cola de generación de PDFs
pdfQueue.process(async (job, done) => {
  const { jobId, userId, liquidacionIds, emailConfig } = job.data;

  try {
    // Obtener el estado del trabajo
    const jobState = activeJobs.get(jobId);
    if (!jobState) {
      throw new Error("Trabajo no encontrado");
    }

    // Actualizar estado a procesando
    jobState.status = "processing";
    updateJobProgress(jobId, 10, userId);

    // Obtener liquidaciones con datos de conductor
    const liquidaciones = await Liquidacion.findAll({
      where: { id: liquidacionIds },
      include: [
        { model: Conductor, as: "conductor" },
        { model: Bonificacion, as: "bonificaciones" },
        { model: Pernote, as: "pernotes" },
        { model: Recargo, as: "recargos" },
        { model: Anticipo, as: "anticipos" },
      ],
    });

    if (liquidaciones.length === 0) {
      throw new Error("No se encontraron liquidaciones para procesar");
    }

    // Verificar que todos los conductores tienen email
    const sinEmail = liquidaciones.filter(
      (liq) => !liq.conductor || !liq.conductor.email
    );
    if (sinEmail.length > 0) {
      throw new Error(
        `${sinEmail.length} conductores no tienen email configurado`
      );
    }

    // Generar PDFs para cada liquidación
    const pdfBuffers = [];
    for (let i = 0; i < liquidaciones.length; i++) {
      const liquidacion = liquidaciones[i];

      // Actualizar progreso
      const progress = Math.round(10 + (i / liquidaciones.length) * 50); // 10% - 60%
      updateJobProgress(jobId, progress, userId);

      try {
        console.log(`📋 Procesando liquidación ${i + 1}/${liquidaciones.length} - ID: ${liquidacion.id}`);

        // ✅ PASO 1: Obtener configuraciones de salario usando función auxiliar
        const configuracionesSalario = await obtenerConfiguracionesSalario(
          liquidacion.periodo_start,
          liquidacion.periodo_end
        );

        console.log(`⚙️ Encontradas ${configuracionesSalario.length} configuraciones de salario para el período`);

        // ✅ PASO 2: Obtener recargos planilla del conductor usando función auxiliar
        let recargosDelPeriodo = [];
        if (liquidacion.conductor?.id) {
          recargosDelPeriodo = await obtenerRecargosPlanillaPorPeriodo(
            liquidacion.conductor.id,
            liquidacion.periodo_start,
            liquidacion.periodo_end
          );
          console.log(`📊 Encontrados ${recargosDelPeriodo.length} recargos planilla para el conductor ${liquidacion.conductor.id}`);
        } else {
          console.warn(`⚠️ Liquidación ${liquidacion.id} no tiene conductor válido`);
        }

        // ✅ PASO 3: Procesar recargos con configuración salarial usando función auxiliar
        let recargosProcessados = [];
        if (recargosDelPeriodo.length > 0) {
          recargosProcessados = await procesarRecargosPorPeriodoConSalarios(
            recargosDelPeriodo,
            liquidacion.periodo_start,
            liquidacion.periodo_end,
            configuracionesSalario
          );
          console.log(`🔄 Procesados ${recargosProcessados.length} recargos con cálculo salarial`);
        }

        // ✅ PASO 4: Construir liquidación completa para PDF
        const liquidacionCompleta = {
          ...liquidacion.toJSON(),
          configuraciones_salario: configuracionesSalario,
          recargos_planilla: {
            periodo_start: liquidacion.periodo_start,
            periodo_end: liquidacion.periodo_end,
            total_recargos: recargosProcessados.length,
            total_dias_laborados: recargosProcessados.reduce((total, recargo) =>
              total + (recargo.dias_laborales?.length || 0), 0),
            total_horas_trabajadas: recargosProcessados.reduce((total, recargo) =>
              total + (parseFloat(recargo.total_horas) || 0), 0),
            recargos: recargosProcessados
          }
        };

        // ✅ PASO 5: Generar PDF con los datos completos
        const pdfBuffer = await generatePDF(liquidacionCompleta);

        // Verificar que el buffer es válido
        if (!Buffer.isBuffer(pdfBuffer)) {
          console.error(
            `❌ Error: El PDF generado para liquidación ${liquidacion.id} no es un Buffer válido`
          );
          throw new Error("El PDF generado no es válido");
        }

        // Verificar tamaño y contenido
        if (pdfBuffer.length <= 10) {
          console.error(
            `❌ Error: El PDF generado para liquidación ${liquidacion.id} está vacío o demasiado pequeño`
          );
          throw new Error("El PDF generado está vacío o es muy pequeño");
        }

        console.log(`✅ PDF generado exitosamente para liquidación ${liquidacion.id} (${pdfBuffer.length} bytes)`);

        pdfBuffers.push({
          data: pdfBuffer,
          filename: `${liquidacion.conductor?.numero_identificacion || ""}_${liquidacion.id}_${getMesyAño(liquidacion.periodo_end)}.pdf`,
          conductorId: liquidacion.conductor?.id,
          email: liquidacion.conductor?.email,
          liquidacionId: liquidacion.id,
          // Agregar información adicional para debugging si es necesario
          recargos_procesados: recargosProcessados.length,
          configuraciones_encontradas: configuracionesSalario.length
        });

      } catch (pdfError) {
        console.error(
          `❌ Error al generar PDF para liquidación ${liquidacion.id}:`,
          pdfError
        );

        // Opcional: Agregar más información del error para debugging
        console.error(`📋 Detalles de la liquidación con error:`, {
          id: liquidacion.id,
          conductor_id: liquidacion.conductor?.id,
          periodo_start: liquidacion.periodo_start,
          periodo_end: liquidacion.periodo_end,
          error_message: pdfError.message
        });

        // Opcional: Si quieres continuar con las demás liquidaciones en caso de error
        // o si quieres que falle completamente, puedes decidir aquí
        // throw pdfError; // Descomentar para que falle completamente
      }
    }

    // Verificar que se generaron PDFs
    if (pdfBuffers.length === 0) {
      throw new Error("No se pudo generar ningún PDF");
    }

    // Actualizar progreso
    updateJobProgress(jobId, 60, userId); // 60%

    // Agregar trabajo a la cola de envío de correos
    await emailQueue.add(
      {
        jobId,
        userId,
        pdfBuffers,
        liquidacionIds,
        emailConfig,
      },
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
      }
    );

    // El trabajo actual está completo (la cola de emails continuará el proceso)
    return done(null, { success: true });
  } catch (error) {
    console.error(`Error en generación de PDFs para trabajo ${jobId}:`, error);

    // Actualizar estado del trabajo
    const jobState = activeJobs.get(jobId);
    if (jobState) {
      jobState.status = "failed";
      jobState.error =
        error.message || "Error desconocido durante la generación de PDFs";

      // Notificar al usuario
      notifyUser(userId, "job:failed", {
        jobId,
        error: jobState.error,
      });
    }

    return done(error);
  }
});

// Manejador para la cola de envío de correos
emailQueue.process(async (job, done) => {
  const { jobId, userId, pdfBuffers, emailConfig, liquidacionIds } = job.data;

  try {
    // Obtener el estado del trabajo
    const jobState = activeJobs.get(jobId);
    if (!jobState) {
      throw new Error("Trabajo no encontrado");
    }

    // Actualizar progreso
    updateJobProgress(jobId, 65, userId); // 65%

    // ===== OBTENER TODAS LAS LIQUIDACIONES CON CONDUCTORES Y RECARGOS =====
    const liquidacionesCompletas = await Liquidacion.findAll({
      where: {
        id: liquidacionIds
      },
      include: [
        {
          model: Conductor,
          as: 'conductor',
          attributes: ['id', 'email', 'nombre', 'apellido']
        },
        {
          model: Recargo,
          as: "recargos"
        }
      ]
    });

    if (liquidacionesCompletas.length === 0) {
      throw new Error("No se encontraron liquidaciones para procesar");
    }

    // ===== CREAR MAPEO LIQUIDACIÓN -> DATOS COMPLETOS =====
    const liquidacionToDatos = {};

    liquidacionesCompletas.forEach(liquidacion => {
      const recargosParex = liquidacion.recargos?.filter(
        (recargo) => recargo.empresa_id === "cfb258a6-448c-4469-aa71-8eeafa4530ef"
      ) || [];

      const totalRecargosParex = recargosParex.reduce(
        (sum, recargo) => sum + (recargo.valor || 0),
        0
      );

      liquidacionToDatos[liquidacion.id] = {
        email: liquidacion.conductor.email,
        conductorId: liquidacion.conductor.id,
        conductorNombre: `${liquidacion.conductor.nombre} ${liquidacion.conductor.apellido}`,
        firmaDesprendible: totalRecargosParex > 0,
        totalRecargos: totalRecargosParex,
        recargosCount: recargosParex.length,
        periodoEnd: liquidacion.periodo_end,
        periodoStart: liquidacion.periodo_start
      };
    });

    // ===== HELPER: Función para formatear período =====
    const getMesyAño = (dateStr) => {
      if (!dateStr) return "";
      try {
        const date = new Date(dateStr);
        return date
          .toLocaleDateString("es-CO", {
            month: "long",
            year: "numeric",
          })
          .toUpperCase();
      } catch (e) {
        console.error("Error formatting date:", e);
        return "";
      }
    };

    const emailData = {};
    const pdfsNoCorrelacionados = [];

    for (let pdfIndex = 0; pdfIndex < pdfBuffers.length; pdfIndex++) {
      const pdf = pdfBuffers[pdfIndex];

      // MÉTODO 1: Buscar por liquidación ID en el filename
      let liquidacionIdFromFilename = null;
      const liquidacionIdMatch = pdf.filename.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
      if (liquidacionIdMatch) {
        liquidacionIdFromFilename = liquidacionIdMatch[0];
      }

      // MÉTODO 2: Buscar por conductorId si está disponible
      let liquidacionIdFromConductor = null;
      if (pdf.conductorId) {
        const liquidacionPorConductor = Object.entries(liquidacionToDatos).find(
          ([id, datos]) => datos.conductorId === pdf.conductorId
        );
        if (liquidacionPorConductor) {
          liquidacionIdFromConductor = liquidacionPorConductor[0];
        }
      }

      // MÉTODO 3: Buscar por email si está disponible
      let liquidacionIdFromEmail = null;
      if (pdf.email) {
        const liquidacionPorEmail = Object.entries(liquidacionToDatos).find(
          ([id, datos]) => datos.email === pdf.email
        );
        if (liquidacionPorEmail) {
          liquidacionIdFromEmail = liquidacionPorEmail[0];
        }
      }

      // Decidir qué liquidación usar (prioridad: filename > conductorId > email)
      const liquidacionId = liquidacionIdFromFilename || liquidacionIdFromConductor || liquidacionIdFromEmail;

      if (!liquidacionId || !liquidacionToDatos[liquidacionId]) {
        console.error(`❌ No se pudo correlacionar PDF: ${pdf.filename}`);
        console.error(`   - ID del filename: ${liquidacionIdFromFilename}`);
        console.error(`   - ID del conductor: ${liquidacionIdFromConductor}`);
        console.error(`   - ID del email: ${liquidacionIdFromEmail}`);
        pdfsNoCorrelacionados.push(pdf);
        continue;
      }

      const datosLiquidacion = liquidacionToDatos[liquidacionId];
      const email = datosLiquidacion.email;

      // Inicializar estructura para el email si no existe
      if (!emailData[email]) {
        emailData[email] = {
          conductorNombre: datosLiquidacion.conductorNombre,
          liquidaciones: []
        };
      }

      try {
        // Procesar PDF content
        let pdfContent;

        if (Buffer.isBuffer(pdf.data)) {
          pdfContent = pdf.data;
        } else if (typeof pdf.data === "string") {
          pdfContent = Buffer.from(pdf.data, "base64");
        } else if (pdf.data && typeof pdf.data === "object") {
          if (pdf.data.type === "Buffer" && Array.isArray(pdf.data.data)) {
            pdfContent = Buffer.from(pdf.data.data);
          } else if (pdf.data.buffer && Buffer.isBuffer(pdf.data.buffer)) {
            pdfContent = pdf.data.buffer;
          } else {
            pdfContent = await generateFallbackPDF(pdf.filename);
          }
        } else {
          pdfContent = await generateFallbackPDF(pdf.filename);
        }

        // Verificar que el contenido es válido
        if (Buffer.isBuffer(pdfContent) && pdfContent.length > 0) {
          emailData[email].liquidaciones.push({
            liquidacionId: liquidacionId,
            firmaDesprendible: datosLiquidacion.firmaDesprendible,
            totalRecargos: datosLiquidacion.totalRecargos,
            periodoFormateado: getMesyAño(datosLiquidacion.periodoEnd),
            attachment: {
              filename: pdf.filename,
              content: pdfContent,
              contentType: "application/pdf",
            }
          });
        } else {
          console.error(`❌ Buffer inválido para ${pdf.filename}`);
        }
      } catch (attachmentError) {
        console.error(`❌ Error procesando ${pdf.filename}:`, attachmentError);

        try {
          const fallbackPdf = await generateFallbackPDF(pdf.filename);
          emailData[email].liquidaciones.push({
            liquidacionId: liquidacionId,
            firmaDesprendible: datosLiquidacion.firmaDesprendible,
            totalRecargos: datosLiquidacion.totalRecargos,
            periodoFormateado: getMesyAño(datosLiquidacion.periodoEnd),
            attachment: {
              filename: pdf.filename,
              content: fallbackPdf,
              contentType: "application/pdf",
            }
          });
        } catch (fallbackError) {
          console.error(`❌ Error generando respaldo para ${pdf.filename}:`, fallbackError);
        }
      }
    }

    // ===== VERIFICAR COBERTURA COMPLETA =====
    const emailsConPdfs = Object.keys(emailData);
    const totalPdfsAsignados = Object.values(emailData).reduce(
      (total, data) => total + data.liquidaciones.length, 0
    );

    // ===== EL RESTO DEL CÓDIGO DE ENVÍO PERMANECE IGUAL =====

    for (let i = 0; i < emailsConPdfs.length; i++) {
      const email = emailsConPdfs[i];
      const data = emailData[email];

      if (data.liquidaciones.length === 0) {
        console.warn(`⚠️ No hay liquidaciones válidas para ${email}, omitiendo`);
        continue;
      }

      const progress = Math.round(65 + (i / emailsConPdfs.length) * 35);
      updateJobProgress(jobId, progress, userId);

      const liquidacionesConFirma = data.liquidaciones.filter(liq => liq.firmaDesprendible);
      const liquidacionesSinFirma = data.liquidaciones.filter(liq => !liq.firmaDesprendible);

      let emailOptions = {
        to: email,
        subject: emailConfig.subject,
        text: emailConfig.body,
        liquidacionId: data.liquidaciones[0].liquidacionId,
        firmaDesprendible: false,
        attachments: [],
        liquidacionesParaFirma: [],
        hasAttachments: false,
        mensajeContextual: ""
      };

      if (liquidacionesConFirma.length === 0) {
        emailOptions.attachments = liquidacionesSinFirma.map(liq => liq.attachment);
        emailOptions.hasAttachments = true;
        emailOptions.mensajeContextual = `Encontrará adjuntos ${liquidacionesSinFirma.length} desprendible${liquidacionesSinFirma.length > 1 ? 's' : ''} de nómina.`;

      } else if (liquidacionesSinFirma.length === 0) {
        emailOptions.firmaDesprendible = true;
        emailOptions.liquidacionesParaFirma = liquidacionesConFirma;

        if (liquidacionesConFirma.length === 1) {
          emailOptions.mensajeContextual = `Su desprendible de ${liquidacionesConFirma[0].periodoFormateado} requiere firma digital.`;
        } else {
          emailOptions.mensajeContextual = `Tiene ${liquidacionesConFirma.length} desprendibles que requieren firma digital.`;
        }

      } else {
        emailOptions.attachments = liquidacionesSinFirma.map(liq => liq.attachment);
        emailOptions.hasAttachments = true;
        emailOptions.firmaDesprendible = true;
        emailOptions.liquidacionesParaFirma = liquidacionesConFirma;

        if (liquidacionesConFirma.length === 1) {
          emailOptions.mensajeContextual = `Encontrará adjunto${liquidacionesSinFirma.length > 1 ? 's' : ''} ${liquidacionesSinFirma.length} desprendible${liquidacionesSinFirma.length > 1 ? 's' : ''}. Adicionalmente, su desprendible de ${liquidacionesConFirma[0].periodoFormateado} requiere firma digital.`;
        } else {
          emailOptions.mensajeContextual = `Encontrará adjuntos ${liquidacionesSinFirma.length} desprendible${liquidacionesSinFirma.length > 1 ? 's' : ''}. Adicionalmente, tiene ${liquidacionesConFirma.length} desprendibles que requieren firma digital.`;
        }
      }

      try {
        await sendEmail(emailOptions);
      } catch (emailErr) {
        console.error(`❌ Error enviando email a ${email}:`, emailErr);
      }
    }

    // Actualizar estado a completado
    jobState.status = "completed";
    jobState.progress = 100;
    jobState.completedTime = new Date();

    notifyUser(userId, "job:completed", {
      jobId,
      result: {
        totalEmails: emailsConPdfs.length,
        totalAttachments: totalPdfsAsignados,
        pdfsNoCorrelacionados: pdfsNoCorrelacionados.length
      },
    });

    setTimeout(() => {
      activeJobs.delete(jobId);
    }, 30 * 60 * 1000);

    return done(null, { success: true });
  } catch (error) {
    console.error(`❌ Error en envío de emails para trabajo ${jobId}:`, error);

    const jobState = activeJobs.get(jobId);
    if (jobState) {
      jobState.status = "failed";
      jobState.error = error.message || "Error desconocido durante el envío de correos";

      notifyUser(userId, "job:failed", {
        jobId,
        error: jobState.error,
      });
    }

    return done(error);
  }
});

/**
 * Construir URL pública de S3
 * @param {string} fileName - Nombre del archivo en S3
 * @param {string} folder - Carpeta en S3 (default: 'assets')
 * @returns {string} URL pública completa
 */
function getS3PublicUrl(fileName, folder = 'assets') {
  const bucketName = process.env.AWS_S3_BUCKET_NAME || 'transmeralda';
  const region = process.env.AWS_REGION || 'us-east-2';

  return `https://${bucketName}.s3.${region}.amazonaws.com/${folder}/${fileName}`;
}

// Función para crear el template HTML
function createEmailTemplate(content, options = {}) {
  const {
    logoFileName = 'codi.png',
    companyName = 'Transportes y Servicios Esmeralda S.A.S',
    showLogo = true,
    liquidacionId,
    firmaDesprendible = false,
    liquidacionesParaFirma = [],
    hasAttachments = false,
    mensajeContextual = ''
  } = options;

  // Construir URL del logo desde S3
  const logoUrl = showLogo ? getS3PublicUrl(logoFileName) : null;

  // Generar contenido dinámico según el tipo de envío
  let desprendiblesSection = '';

  if (firmaDesprendible && liquidacionesParaFirma.length > 0) {
    if (liquidacionesParaFirma.length === 1) {
      // Un solo enlace - usar botón actual
      const liquidacion = liquidacionesParaFirma[0];
      const desprendibleUrl = `${process.env.NOMINA_SYSTEM}/conductores/desprendible/${liquidacion.liquidacionId}`;

      desprendiblesSection = `
        <div class="desprendible-section">
          <h3>📄 Desprendible de Nómina</h3>
          <p>Haga clic en el siguiente botón para ver y firmar su desprendible de <strong>${liquidacion.periodoFormateado}</strong>:</p>
          <a href="${desprendibleUrl}" class="button" target="_blank" rel="noopener">
            Ver y Firmar Desprendible
          </a>
          <p style="font-size: 14px; margin-top: 15px; color: #6b7280;">
            <strong>Importante:</strong> Este enlace le permitirá acceder a su desprendible de manera segura.
          </p>
        </div>
      `;
    } else {
      // Múltiples enlaces - crear lista
      const enlaces = liquidacionesParaFirma.map(liquidacion => {
        const desprendibleUrl = `${process.env.NOMINA_SYSTEM}/conductores/desprendible/${liquidacion.liquidacionId}`;
        return `
          <div class="enlace-individual">
            <h4>📄 ${liquidacion.periodoFormateado}</h4>
            <a href="${desprendibleUrl}" class="button-small" target="_blank" rel="noopener">
              Ver y Firmar Desprendible
            </a>
          </div>
        `;
      }).join('');

      desprendiblesSection = `
        <div class="desprendible-section">
          <h3>📄 Desprendibles que Requieren Firma</h3>
          <p>Tiene <strong>${liquidacionesParaFirma.length} desprendibles</strong> que requieren firma digital:</p>
          <div class="enlaces-container">
            ${enlaces}
          </div>
          <p style="font-size: 14px; margin-top: 20px; color: #6b7280;">
            <strong>Importante:</strong> Cada enlace le permitirá acceder al desprendible correspondiente de manera segura.
          </p>
        </div>
      `;
    }
  }

  const template = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Comprobante de Nómina</title>
    <style>
        /* Reset */
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
        
        /* Estilos principales */
        body {
            margin: 0 !important;
            padding: 0 !important;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif !important;
            background-color: #f8fafc !important;
            line-height: 1.6;
        }
        
        .email-wrapper {
            width: 100%;
            background-color: #f8fafc;
            padding: 20px 0;
        }
        
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #059669, #047857);
            padding: 30px 20px;
            text-align: center;
            color: white;
        }
        
        .logo {
            max-width: 250px;
            height: auto;
            margin-bottom: 15px;
            display: inline-block;
        }
        
        .header h1 {
            margin: 10px 0 5px 0;
            font-size: 24px;
            font-weight: 600;
            color: #ffffff;
        }
        
        .content {
            padding: 40px 30px;
            color: #374151;
        }
        
        .content h2 {
            color: #059669;
            margin-top: 0;
            margin-bottom: 20px;
            font-size: 20px;
            border-bottom: 2px solid #ecfdf5;
            padding-bottom: 10px;
        }
        
        .content p {
            margin-bottom: 16px;
            font-size: 16px;
            line-height: 1.6;
        }
        
        .mensaje-contextual {
            background-color: #f0f9ff;
            border-left: 4px solid #0284c7;
            padding: 20px;
            margin: 25px 0;
            border-radius: 6px;
        }
        
        .mensaje-contextual p {
            margin: 0;
            color: #0369a1;
            font-size: 16px;
        }
        
        .button {
            display: inline-block;
            background: linear-gradient(135deg, #059669, #047857);
            color: white !important;
            padding: 14px 28px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            margin: 20px 0;
            text-align: center;
            transition: all 0.3s ease;
            box-shadow: 0 4px 6px rgba(5, 150, 105, 0.3);
        }
        
        .button:hover {
            background: linear-gradient(135deg, #047857, #059669);
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(5, 150, 105, 0.4);
        }
        
        .button-small {
            display: inline-block;
            background: linear-gradient(135deg, #0284c7, #0369a1);
            color: white !important;
            padding: 10px 20px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 500;
            font-size: 14px;
            margin: 10px 0;
            text-align: center;
            transition: all 0.3s ease;
        }
        
        .desprendible-section {
            background-color: #f0f9ff;
            border: 2px solid #0284c7;
            padding: 25px;
            border-radius: 10px;
            margin: 25px 0;
            text-align: center;
        }
        
        .desprendible-section h3 {
            color: #0284c7;
            margin: 0 0 15px 0;
            font-size: 18px;
        }
        
        .desprendible-section p {
            color: #0369a1;
            margin-bottom: 20px;
        }
        
        .enlaces-container {
            display: flex;
            flex-direction: column;
            gap: 15px;
            margin: 20px 0;
        }
        
        .enlace-individual {
            background-color: #ffffff;
            border: 1px solid #e0e7ff;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
        }
        
        .enlace-individual h4 {
            margin: 0 0 10px 0;
            color: #1e40af;
            font-size: 16px;
        }
        
        .attachment-notice {
            background-color: #fef3c7;
            border: 1px solid #fcd34d;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
        }
        
        .attachment-notice p {
            margin: 0;
            color: #92400e;
        }
        
        .footer {
            background-color: #f9fafb;
            padding: 30px;
            text-align: center;
            border-top: 2px solid #e5e7eb;
            color: #6b7280;
            font-size: 13px;
        }
        
        .footer p {
            margin: 5px 0;
        }
        
        /* Responsive */
        @media screen and (max-width: 600px) {
            .email-container {
                width: 100% !important;
                margin: 0 !important;
                border-radius: 0 !important;
            }
            
            .content {
                padding: 30px 20px !important;
            }
            
            .header {
                padding: 25px 15px !important;
            }
            
            .header h1 {
                font-size: 20px !important;
            }
            
            .desprendible-section {
                padding: 20px 15px !important;
            }
            
            .enlaces-container {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="email-wrapper">
        <div class="email-container">
            <!-- Header con logo desde S3 -->
            <div class="header">
                ${logoUrl ? `
                    <img src="${logoUrl}" alt="${companyName}" class="logo" />
                ` : ''}
                <h1>${companyName}</h1>
            </div>
            
            <!-- Contenido principal -->
            <div class="content">
                <h2>Desprendibles de Nómina</h2>
                ${content}
                
                ${mensajeContextual ? `
                    <div class="mensaje-contextual">
                        <p>${mensajeContextual}</p>
                    </div>
                ` : ''}
                
                ${hasAttachments && !firmaDesprendible ? `
                    <div class="attachment-notice">
                        <p><strong>📎 Archivos Adjuntos:</strong> Revise los desprendibles adjuntos en este correo.</p>
                    </div>
                ` : ''}
                
                ${desprendiblesSection}
                
                ${hasAttachments && firmaDesprendible ? `
                    <div class="attachment-notice">
                        <p><strong>📎 Archivos Adjuntos:</strong> Algunos desprendibles están adjuntos en este correo, otros requieren firma digital usando los enlaces anteriores.</p>
                    </div>
                ` : ''}
            </div>
            
            <!-- Footer -->
            <div class="footer">
                <p><strong>Este es un mensaje automático</strong></p>
                <p>Por favor no responder directamente a este correo.</p>
                <p>Si tiene alguna pregunta, contacte a su supervisor o al departamento de recursos humanos.</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                <p>&copy; 2025 ${companyName}. Todos los derechos reservados.</p>
                <p style="font-size: 11px; color: #9ca3af;">
                    Este correo electrónico y cualquier archivo adjunto son confidenciales y están destinados 
                    únicamente para el uso del destinatario previsto.
                </p>
            </div>
        </div>
    </div>
</body>
</html>`;
  return template;
}

/**
 * Función para enviar un correo electrónico
 * @param {Object} options - Opciones del correo
 * @returns {Promise<void>}
 */
async function sendEmail(options) {
  try {
    // Configurar el transporte de correo
    const transporterConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    };
    const transporter = nodemailer.createTransport(transporterConfig);

    // ===== PROCESAMIENTO DE ADJUNTOS =====
    let validAttachments = [];

    if (options.firmaDesprendible && !options.hasAttachments) {
      console.log("🚫 NO procesando adjuntos (solo enlaces de firma)");
    } else if (!options.attachments || !Array.isArray(options.attachments)) {
      console.log("⚠️ No hay adjuntos para procesar");
    } else {
      validAttachments = options.attachments.map((attachment, index) => {

        // Manejar diferentes tipos de contenido
        let content = attachment.content;

        // Si es un objeto serializado de Buffer
        if (content && typeof content === 'object' && content.type === 'Buffer') {
          content = Buffer.from(content.data || content);
        }

        // Verificar que es un Buffer válido
        if (Buffer.isBuffer(content) && content.length > 0) {
          return {
            filename: attachment.filename,
            content: content,
            contentType: attachment.contentType || 'application/pdf'
          };
        } else {
          console.log(`❌ Adjunto ${index + 1} inválido:`, attachment.filename);
          return null;
        }
      }).filter(Boolean);
    }

    // ===== CREAR CONTENIDO HTML =====
    const templateOptions = {
      logoFileName: options.logoFileName || 'codi.png',
      companyName: options.companyName || 'Transportes y Servicios Esmeralda S.A.S',
      showLogo: options.showLogo !== false,
      liquidacionId: options.liquidacionId,
      firmaDesprendible: options.firmaDesprendible,
      liquidacionesParaFirma: options.liquidacionesParaFirma || [],
      hasAttachments: options.hasAttachments || false,
      mensajeContextual: options.mensajeContextual || ''
    };

    const htmlContent = createEmailTemplate(
      options.htmlContent || options.text,
      templateOptions
    );

    // ===== PREPARAR Y ENVIAR EMAIL =====
    const mailOptions = {
      from: `${options.fromName || 'Sistema de Nómina'} <${process.env.SMTP_USER}>`,
      to: options.to,
      subject: options.subject || 'Comprobante de Nómina',
      text: options.text || 'Por favor, visualice este correo en un cliente que soporte HTML.',
      html: htmlContent,
      attachments: validAttachments,
    };

    // Enviar el correo
    const result = await transporter.sendMail(mailOptions);

    return result;
  } catch (error) {
    console.error(`❌ Error al enviar correo a ${options.to}:`, error);
    console.error("🔍 Error details:", {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Función para generar un PDF a partir de una liquidación
 * @param {Object} liquidacion - Objeto de liquidación
 * @returns {Promise<Buffer>} - Buffer del PDF generado
 */
async function generatePDF(liquidacion) {
  return new Promise((resolve, reject) => {
    try {
      // Create a new PDFDocument
      const doc = new PDFDocument({
        margins: { top: 30, bottom: 15, left: 40, right: 40 },
        size: "A4",
      });

      const recargosAgrupados = agruparRecargos(
        liquidacion.recargos_planilla,
        liquidacion.configuraciones_salario,
      );

      // Collect data in chunks
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));

      // Resolve promise when document is complete
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(pdfBuffer);
      });

      // Helper functions for common operations
      const safeValue = (value, defaultValue = "") => {
        return value !== undefined && value !== null
          ? typeof value === "string"
            ? value
            : parseInt(value)
          : defaultValue;
      };

      // Función para calcular la diferencia en días entre dos fechas
      const calcularDiferenciaDias = (fechaInicio, fechaFin) => {
        // Convertir strings a objetos Date
        const inicio = new Date(fechaInicio);
        const fin = new Date(fechaFin);

        // Calcular la diferencia en milisegundos
        const diferenciaMs = fin.getTime() - inicio.getTime();

        // Convertir milisegundos a días (1 día = 24 * 60 * 60 * 1000 ms)
        const diferenciaDias = Math.round(diferenciaMs / (24 * 60 * 60 * 1000));

        return diferenciaDias + 1;
      };

      const formatDate = (dateStr) => {
        if (!dateStr) return "";
        try {
          const date = new Date(dateStr);
          return date
            .toLocaleDateString("es-CO", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })
            .toUpperCase();
        } catch (e) {
          console.error("Error formatting date:", e);
          return dateStr;
        }
      };

      const getMesyAño = (dateStr) => {
        if (!dateStr) return "";
        try {
          const date = new Date(dateStr);
          return date
            .toLocaleDateString("es-CO", {
              month: "long",
              year: "numeric",
            })
            .toUpperCase();
        } catch (e) {
          console.error("Error formatting date:", e);
          return "";
        }
      };

      const obtenerDiferenciaDias = ({ start, end }) => {
        if (!start || !end) return 0;
        const startDate = new Date(start);
        const endDate = new Date(end);
        const diffTime = Math.abs(endDate - startDate);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end days
      };

      function formatDateShort(dateStr) {
        if (!dateStr) return "";

        try {
          const date = new Date(dateStr);

          // Obtener el día con dos dígitos
          const day = date.getDate().toString().padStart(2, "0");

          // Obtener el mes abreviado en minúsculas
          const month = date
            .toLocaleString("es", { month: "short" })
            .toLowerCase();

          // Devolver formato "DD-MMM"
          return `${day}-${month}`;
        } catch (error) {
          console.error("Error formatting date:", error);
          return "";
        }
      }

      function formatearHora(hora) {
        if (!hora) return "";

        return hora
          .replace(/\./g, ":") // Cambiar puntos por dos puntos
          .replace(/:50/g, ":30"); // Cambiar :50 por :30
      };

      // Filter recargos data
      const recargosParex =
        liquidacion?.recargos?.filter(
          (recargo) =>
            recargo.empresa_id === "cfb258a6-448c-4469-aa71-8eeafa4530ef"
        ) || [];

      const totalRecargosParex = recargosParex.reduce(
        (sum, recargo) => sum + (recargo.valor || 0),
        0
      );

      const recargosActualizados =
        liquidacion?.recargos?.filter(
          (recargo) =>
            recargo.empresa_id !== "cfb258a6-448c-4469-aa71-8eeafa4530ef"
        ) || [];

      const imagePath = path.join(
        __dirname,
        "..",
        "..",
        "public",
        "assets",
        "codi.png"
      );

      const imageX = 415; // Ajusta estas coordenadas según necesites
      const imageY = 15; // Ajusta la altura donde empieza la tabla de empleado

      // HEADER
      doc
        .fontSize(13)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text("TRANSPORTES Y SERVICIOS ESMERALDA S.A.S", {
          width: 300,
        });

      doc
        .fontSize(10)
        .fillColor("#000000")
        .font("Helvetica")
        .text("NIT: 901528440-3");

      doc.moveDown(1); // Mueve el cursor hacia abajo (alternativa a marginTop)

      doc
        .fontSize(11)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text(`COMPROBANTE DE NOMINA - ${getMesyAño(liquidacion.periodo_end)}`);

      doc.moveDown(1); // Mueve el cursor hacia abajo (alternativa a marginTop)

      doc
        .fontSize(11)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text(`BÁSICO CORRESPONDIENTE AL MES DE - ${getMesyAño(liquidacion.periodo_end)}`);

      // If you have a logo to insert
      doc.image(imagePath, imageX, imageY, {
        fit: [175, 100],
        align: "right",
        valign: "top",
      });

      doc.moveDown(1);

      // EMPLOYEE INFO TABLE
      const tableWidth = doc.page.width - 80;

      // Name
      drawTableRow(
        doc,
        "Nombre",
        `${safeValue(liquidacion.conductor?.nombre)} ${safeValue(
          liquidacion.conductor?.apellido
        )}`,
        {
          valueAlign: "right",
          rowHeight: 26,
          drawVerticalBorders: false,
          borderStyle: "outer",
        }
      );

      // ID
      drawTableRow(
        doc,
        "C.C.",
        safeValue(liquidacion.conductor?.numero_identificacion),
        {
          valueAlign: "right",
          rowHeight: 26,
          drawVerticalBorders: false,
          borderStyle: "outer",
        }
      );

      // Work days
      drawTableRow(
        doc,
        "Días laborados",
        safeValue(liquidacion.dias_laborados, "0"),
        {
          valueAlign: "right",
          rowHeight: 26,
          drawVerticalBorders: false,
          borderStyle: "outer",
        }
      );

      // Salary earned
      drawTableRow(
        doc,
        "Salario devengado",
        formatToCOP(safeValue(liquidacion.salario_devengado, "0")),
        {
          valueStyle: {
            color: "#007AFF",
            fontSize: 12,
            bgColor: "#F0F7FF",
            marginRight: 5,
          },
          valueAlign: "right",
          rowHeight: 26,
          drawVerticalBorders: false,
          borderStyle: "outer",
        }
      );

      // Transport subsidy
      drawTableRow(
        doc,
        "Auxilio de transporte",
        formatToCOP(safeValue(liquidacion.auxilio_transporte, "0")),
        {
          valueStyle: {
            color: "gray",
            fontSize: 12,
            bgColor: "#F0F0F0",
            marginRight: 5,
          },
          valueAlign: "right",
          rowHeight: 26,
          drawVerticalBorders: false,
          borderStyle: "outer",
        }
      );

      // Incapacidad remuneración - Solo mostrar si existe valor y es mayor a 0
      const valorIncapacidad = safeValue(liquidacion.valor_incapacidad, 0);
      if (valorIncapacidad > 0 && valorIncapacidad > 0) {
        drawTableRow(
          doc,
          "Remuneración por incapacidad",
          formatToCOP(valorIncapacidad),
          {
            middleText: `${safeValue(calcularDiferenciaDias(liquidacion.periodo_start_incapacidad, liquidacion.periodo_end_incapacidad), "0")} días`,
            middleAlign: "center",
            valueStyle: {
              color: "#2E8B57",
              fontSize: 12,
              bgColor: "#F3F8F5",
              marginRight: 5,
            },
            valueAlign: "right",
            rowHeight: 26,
            drawVerticalBorders: false,
            borderStyle: "outer",
          }
        );
      }

      // Adjustment
      drawTableRow(
        doc,
        "Ajuste villanueva",
        formatToCOP(safeValue(liquidacion.ajuste_salarial, "0")),
        {
          middleText: `${safeValue(
            liquidacion.dias_laborados_villanueva,
            "0"
          )} días`,
          middleAlign: "center",
          valueStyle: {
            color: "#FF9500",
            fontSize: 12,
            bgColor: "#FFF9F0",
            marginRight: 5,
          },
          valueAlign: "right",
          rowHeight: 26,
          drawVerticalBorders: false,
          borderStyle: "outer",
        }
      );

      doc.moveDown(2);

      // PERIODO
      doc
        .fontSize(13)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text(
          `ADICIONALES ${formatDate(liquidacion.periodo_start)} - ${formatDate(
            liquidacion.periodo_end
          )}`,
          {
            align: "center",
          }
        );

      doc.moveDown(1);

      // CONCEPTS TABLE
      // Table header
      const conceptsTop = doc.y;
      const col1Width = tableWidth * 0.28; // Reduce ligeramente
      const col2Width = tableWidth * 0.44; // Aumenta
      const col3Width = tableWidth * 0.14;
      const col4Width = tableWidth * 0.14; // Asegura que sea suficiente

      // Draw concepts table header
      doc.rect(40, conceptsTop, col1Width, 26);
      doc.rect(40 + col1Width, conceptsTop, col2Width, 26);
      doc.rect(40 + col1Width + col2Width, conceptsTop, col3Width, 26);
      doc.rect(
        40 + col1Width + col2Width + col3Width,
        conceptsTop,
        col4Width,
        26
      );

      doc
        .font("Helvetica-Bold")
        .fillAndStroke("#F3F8F5", "#E0E0E0")
        .fontSize(10)
        .fillColor("#2E8B57")
        .text("CONCEPTO", 48, conceptsTop + 8)
        .text("OBSERVACIÓN", 40 + col1Width + 8, conceptsTop + 8)
        .text("CANTIDAD", 40 + col1Width + col2Width + 8, conceptsTop + 8, {
          width: col3Width - 18,
          align: "center",
        })
        .text(
          "VALOR",
          40 + col1Width + col2Width + col3Width + 8,
          conceptsTop + 8,
          {
            width: col4Width - 18,
            align: "center",
          }
        );

      let currentY = conceptsTop + 26;

      // Helper function for concept table rows
      function drawConceptRow(
        concept,
        observation,
        quantity,
        value,
        options = {}
      ) {
        const {
          isLastRow = false,
          rowHeight = observation.length > 30 ? 35 : 24,
          observationFontSize = 10,
        } = options;

        // Draw row background and borders
        doc.rect(40, currentY, col1Width, rowHeight).stroke("#E0E0E0");
        doc
          .rect(40 + col1Width, currentY, col2Width, rowHeight)
          .stroke("#E0E0E0");
        doc
          .rect(40 + col1Width + col2Width, currentY, col3Width, rowHeight)
          .stroke("#E0E0E0");
        doc
          .rect(
            40 + col1Width + col2Width + col3Width,
            currentY,
            col4Width,
            rowHeight
          )
          .stroke("#E0E0E0");

        // Write concept with normal size
        doc
          .fillColor("#000000")
          .font("Helvetica")
          .fontSize(12)
          .text(concept, 48, currentY + 8);

        // Observation with smaller font size and support for multiple lines
        doc
          .fontSize(observationFontSize)
          .text(observation, 40 + col1Width + 8, currentY + 6);

        // Quantity column
        doc
          .fontSize(12)
          .text(quantity, 40 + col1Width + col2Width + 6, currentY + 8, {
            width: col3Width - 12,
            align: "center",
          });

        // Value column
        doc.text(
          value,
          40 + col1Width + col2Width + col3Width + 6,
          currentY + 8,
          {
            width: col4Width - 12,
            align: "center",
          }
        );

        currentY += rowHeight;
      }

      // Process bonificaciones - group by name
      if (liquidacion.bonificaciones && liquidacion.bonificaciones.length > 0) {
        // Group bonificaciones
        const bonificacionesGroup = {};

        liquidacion.bonificaciones.forEach((bonificacion) => {
          const totalQuantity = bonificacion.values.reduce(
            (sum, val) => sum + (val.quantity || 0),
            0
          );

          if (totalQuantity <= 0) return

          if (bonificacionesGroup[bonificacion.name]) {
            bonificacionesGroup[bonificacion.name].quantity += totalQuantity;
            bonificacionesGroup[bonificacion.name].totalValue +=
              totalQuantity * bonificacion.value;
          } else {
            bonificacionesGroup[bonificacion.name] = {
              name: bonificacion.name,
              quantity: totalQuantity,
              totalValue: totalQuantity * bonificacion.value,
            };
          }
        });

        // Draw bonificaciones rows
        Object.values(bonificacionesGroup).forEach((bono, index, array) => {
          const isLast =
            index === array.length - 1 &&
            recargosActualizados.length === 0 &&
            recargosParex.length === 0 &&
            (!liquidacion.pernotes || liquidacion.pernotes.length === 0);

          drawConceptRow(
            bono.name || "",
            "",
            bono.quantity,
            formatToCOP(bono.totalValue),
            { isLastRow: isLast }
          );
        });
      }

      // Recargos
      drawConceptRow(
        "Recargos",
        "Ver recargos detallados más adelante",
        "",
        0
      );

      // Recargos PAREX if any
      if (recargosParex.length > 0) {
        const isLastRow =
          !liquidacion.pernotes || liquidacion.pernotes.length === 0;

        drawConceptRow(
          "Recargos PAREX",
          "Ver recargos detallados más adelante",
          "",
          formatToCOP(totalRecargosParex),
          { isLastRow }
        );
      }

      // Pernotes
      if (liquidacion.pernotes && liquidacion.pernotes.length > 0) {
        let pernoteText = "";
        try {
          // Función para agrupar fechas consecutivas
          const agruparFechasConsecutivas = (fechas) => {
            if (!fechas || fechas.length === 0) return [];

            // Convertir strings a objetos Date y ordenar
            const fechasOrdenadas = fechas
              .filter((f) => f)
              .map((f) => new Date(f))
              .sort((a, b) => a - b);

            const rangos = [];
            let rangoActual = {
              inicio: fechasOrdenadas[0],
              fin: fechasOrdenadas[0],
            };

            for (let i = 1; i < fechasOrdenadas.length; i++) {
              const fechaActual = fechasOrdenadas[i];
              const fechaAnterior = fechasOrdenadas[i - 1];

              // Verificar si son consecutivas (diferencia de 1 día)
              const diffTime = Math.abs(fechaActual - fechaAnterior);
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

              if (diffDays === 1) {
                // Son consecutivas, extender el rango actual
                rangoActual.fin = fechaActual;
              } else {
                // No son consecutivas, guardar el rango actual y empezar uno nuevo
                rangos.push(rangoActual);
                rangoActual = { inicio: fechaActual, fin: fechaActual };
              }
            }

            // Añadir el último rango
            rangos.push(rangoActual);

            // Formatear rangos
            return rangos.map((rango) => {
              const inicioStr = formatDateShort(rango.inicio);
              const finStr = formatDateShort(rango.fin);

              return inicioStr === finStr
                ? inicioStr // Fecha individual
                : `${inicioStr}~${finStr}`; // Rango
            });
          };

          // Recopilar todas las fechas y agruparlas
          const todasLasFechas = [];
          liquidacion.pernotes.forEach((pernote) => {
            if (pernote.fechas && pernote.fechas.length > 0) {
              todasLasFechas.push(...pernote.fechas);
            }
          });

          const rangos = agruparFechasConsecutivas(todasLasFechas);
          pernoteText = rangos.join(", ");
        } catch (error) {
          console.error("Error formatting pernote date:", error);
        }

        // Calculate total pernotes
        const totalPernotes = liquidacion.pernotes.reduce(
          (total, pernote) =>
            total + (pernote.fechas ? pernote.fechas.length : 0),
          0
        );

        drawConceptRow(
          "Pernotes",
          pernoteText,
          totalPernotes || "0",
          formatToCOP(safeValue(liquidacion.total_pernotes, "0")),
          {
            isLastRow: true,
          }
        );
      } else {
        drawConceptRow("Pernotes", "", "0", formatToCOP(0), {
          isLastRow: true,
        });
      }

      // Reset for deductions table
      currentY = doc.y;

      doc.moveDown(2);

      // PERIOD
      doc
        .fontSize(12)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text(
          "DEDUCCIONES",
          40, // Posición x (izquierda)
          doc.y, // Posición y (mantener la posición actual)
          {
            width: doc.page.width - 80, // Ancho (restando márgenes)
            align: "left",
          }
        );

      doc.moveDown(1);

      // Salud
      drawTableRow(
        doc,
        "Salud",
        formatToCOP(safeValue(liquidacion.salud, "0")),
        {
          valueStyle: {
            color: "#e60f0f",
            fontSize: 12,
            bgColor: "#FDF1F1",
            marginRight: 5,
          },
          valueAlign: "right",
          rowHeight: 26,
          borderStyle: "outer",
        }
      );

      // Pensión
      drawTableRow(
        doc,
        "Pensión",
        formatToCOP(safeValue(liquidacion.pension, "0")),
        {
          valueStyle: {
            color: "#e60f0f",
            fontSize: 12,
            bgColor: "#FDF1F1",
            marginRight: 5,
          },
          valueAlign: "right",
          rowHeight: 26,
          borderStyle: "outer",
        }
      );

      // Anticipos (if applicable)
      if (liquidacion.anticipos && liquidacion.anticipos.length > 0) {
        drawTableRow(
          doc,
          "Anticipos",
          formatToCOP(safeValue(liquidacion.total_anticipos, "0")),
          {
            valueStyle: {
              color: "#e60f0f",
              fontSize: 12,
              bgColor: "#FDF1F1",
              marginRight: 5,
            },
            valueAlign: "right",
            rowHeight: 26,
            borderStyle: "outer",
          }
        );
      }

      doc.moveDown(1.5);

      // PERIOD
      doc
        .fontSize(12)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text(
          "RESUMEN FINAL",
          40, // Posición x (izquierda)
          doc.y, // Posición y (mantener la posición actual)
          {
            width: doc.page.width - 80, // Ancho (restando márgenes)
            align: "left",
          }
        );

      doc.moveDown(1);

      if (safeValue(liquidacion.total_vacaciones, "0") > 0) {
        const vacationDays =
          liquidacion.periodo_start_vacaciones &&
            liquidacion.periodo_end_vacaciones
            ? obtenerDiferenciaDias({
              start: liquidacion.periodo_start_vacaciones,
              end: liquidacion.periodo_end_vacaciones,
            })
            : 0;

        drawTableRow(
          doc,
          "Vacaciones",
          formatToCOP(safeValue(liquidacion.total_vacaciones, "0")),
          {
            middleText: `${vacationDays} días`,
            middleAlign: "center",
            valueStyle: {
              color: "#FF9500",
              fontSize: 12,
              bgColor: "#FFF9F0",
              marginRight: 5,
            },
            valueAlign: "right",
            rowHeight: 26,
            borderStyle: "outer",
          }
        );
      }

      // Interés Cesantías (if applicable)
      if (safeValue(liquidacion.interes_cesantias, "0") > 0) {
        drawTableRow(
          doc,
          "Interes cesantias",
          formatToCOP(safeValue(liquidacion.interes_cesantias, "0")),
          {
            valueStyle: {
              color: "#007AFF",
              fontSize: 12,
              bgColor: "#F0F7FF",
              marginRight: 5,
            },
            valueAlign: "right",
            rowHeight: 26,
            borderStyle: "outer",
          }
        );
      }

      // TOTAL SECTION
      drawTableRow(
        doc,
        "Salario total",
        formatToCOP(safeValue(liquidacion.sueldo_total, "0")),
        {
          headerStyle: { fontSize: 12 },
          valueStyle: {
            color: "#2E8B57",
            fontSize: 12,
            bgColor: "#F3F8F5",
            marginRight: 5,
          },
          rowHeight: 26,
          valueAlign: "right",
          borderStyle: "outer",
        }
      );

      // FOOTER
      const footerTop = doc.page.height - 30;
      doc
        .fontSize(10)
        .fillColor("#9E9E9E")
        .font("Helvetica")
        .text(
          `Documento generado el ${new Date().toLocaleDateString()}`,
          40,
          footerTop,
          {
            align: "center",
            width: doc.page.width - 80,
          }
        );


      // ============ SECCIÓN DE RECARGOS AGRUPADOS CORREGIDA ============
      // Agregar esta lógica justo ANTES del doc.end() en tu función generatePDF:

      if (recargosAgrupados && Array.isArray(recargosAgrupados) && recargosAgrupados.length > 0) {
        console.log(`Iniciando procesamiento de ${recargosAgrupados.length} grupos de recargos`);

        // Debug: mostrar estructura de los primeros grupos
        recargosAgrupados.slice(0, 2).forEach((grupo, index) => {
          console.log(`Grupo ${index}:`, {
            keys: Object.keys(grupo || {}),
            tieneRecargos: !!(grupo && (grupo.recargos || grupo.items || grupo.data)),
            cantidadRecargos: (grupo && (grupo.recargos || grupo.items || grupo.data || []).length) || 0
          });
        });

        // Calcular páginas necesarias
        const resultado = agruparEnPaginas(doc, recargosAgrupados);

        if (resultado.totalPaginas === 0) {
          console.log('No hay páginas de recargos para generar');
        } else {
          console.log(`Se crearán ${resultado.totalPaginas} páginas adicionales para recargos`);
          console.log('Distribución:', resultado.resumen);

          // Generar cada página de recargos
          resultado.paginas.forEach((gruposPagina, indicePagina) => {
            // Agregar nueva página
            doc.addPage();

            // Título de la página
            doc
              .fontSize(16)
              .fillColor("#2E8B57")
              .font("Helvetica-Bold")
              .text('HORAS EXTRAS Y RECARGOS', 40, 50, {
                align: "center"
              });

            let yActual = 50;

            // Procesar cada grupo en esta página
            gruposPagina.forEach((grupo, indiceGrupo) => {
              // Obtener los recargos del grupo
              const recargosArray = grupo.recargos || grupo.items || grupo.data || [];
              if (recargosArray.length === 0) {
                console.warn(`Grupo ${indiceGrupo} no tiene recargos válidos`);
                return;
              }

              yActual += 30;

              // Encabezado de la tabla para este grupo
              const tableWidth = doc.page.width - 80;
              // Dibujar UNA SOLA celda que ocupe todo el ancho de la tabla
              doc.rect(40, yActual, tableWidth, 25)
                .fillAndStroke("#2E8B57", "#E0E0E0");

              doc
                .font("Helvetica-Bold")
                .fontSize(10)
                .fillColor("#fff")
                // Texto izquierdo
                .text(`VEHÍCULO: ${grupo.vehiculo.placa}`, 45, yActual + 8)
                // Texto derecho
                .text(`MES: ${new Date(grupo.año, grupo.mes - 1).toLocaleString("es-ES", {
                  month: "long",
                }).toUpperCase()}`, 40, yActual + 8, {
                  width: tableWidth - 10,
                  align: 'right',
                });

              yActual += 25;

              // Información de la empresa - fila completa con fondo blanco y borde
              const infoHeight = 60; // Altura para 3 líneas de texto

              doc.rect(40, yActual, tableWidth, infoHeight)
                .fillAndStroke("#ffffff", "#cccccc");

              // Texto de la empresa
              doc
                .font("Helvetica-Bold")
                .fontSize(11)
                .fillColor("#000000")
                .text("EMPRESA:", 45, yActual + 8)
                .font("Helvetica")
                .text(`${grupo.empresa.nombre} - NIT: ${grupo.empresa.nit}`, 105, yActual + 8);

              // Valor/Hora Base
              doc
                .font("Helvetica")
                .fontSize(11)
                .fillColor("#666666")
                .text(`Valor/Hora Base: $${Math.round(grupo.valor_hora_base).toLocaleString()}${grupo.configuracion_salarial?.empresa
                  ? ` (${grupo.empresa.nombre})`
                  : ''
                  }`, 45, yActual + 42);

              yActual += infoHeight;

              // Encabezados de columnas
              const totalColumnas = 10;
              const anchoBase = (tableWidth / totalColumnas) + 2.7;

              const colDia = anchoBase;
              const colHorario = anchoBase * 1.5;
              const colHoras = anchoBase;
              const colHED = anchoBase;
              const colRN = anchoBase;
              const colHEN = anchoBase;
              const colRD = anchoBase;
              const colHEFD = anchoBase;
              const colHEFN = anchoBase;

              let xPos = 40;

              // Dibujar celdas de encabezado
              const encabezados = [
                { texto: 'DÍA', ancho: colDia },
                { texto: 'HORARIO', ancho: colHorario },
                { texto: 'HORAS', ancho: colHoras },
                { texto: 'HED', ancho: colHED },
                { texto: 'RN', ancho: colRN },
                { texto: 'HEN', ancho: colHEN },
                { texto: 'RD', ancho: colRD },
                { texto: 'HEFD', ancho: colHEFD },
                { texto: 'HEFN', ancho: colHEFN }
              ];

              encabezados.forEach(encabezado => {
                // 1. Dibujar el rectángulo de fondo
                doc.rect(xPos, yActual, encabezado.ancho, 25)
                  .fillAndStroke("#F3F8F5", "#E0E0E0")
                  .stroke("#E0E0E0");

                // 2. Agregar texto centrado
                doc
                  .font("Helvetica-Bold")
                  .fontSize(10)
                  .fillColor("#2E8B57")
                  .text(
                    encabezado.texto,
                    xPos,
                    yActual + 8,
                    {
                      width: encabezado.ancho,
                      align: 'center'
                    }
                  );

                xPos += encabezado.ancho;
              });

              yActual += 25;

              // Después de crear los encabezados, agregar las filas de datos
              grupo.dias_laborales_unificados
                ?.filter((dia) => dia)
                .forEach((dia, diaIndex) => {
                  // Verificar si necesitamos una nueva página
                  if (yActual > doc.page.height - 100) {
                    doc.addPage();
                    yActual = 50; // Reset Y position
                  }

                  let xPos = 40;
                  const rowHeight = 20;

                  // Crear array con los datos de cada columna
                  const datosColumnas = [
                    { valor: dia.dia, ancho: colDia },
                    { valor: `${formatearHora(dia.hora_inicio)}-${formatearHora(dia.hora_fin)}`, ancho: colHorario },
                    { valor: dia.total_horas, ancho: colHoras },
                    { valor: (dia.hed || 0) !== 0 ? `${dia.hed}` : "-", ancho: colHED },
                    { valor: (dia.rn || 0) !== 0 ? `${dia.rn}` : "-", ancho: colRN },
                    { valor: (dia.hen || 0) !== 0 ? `${dia.hen}` : "-", ancho: colHEN },
                    { valor: (dia.rd || 0) !== 0 ? `${dia.rd}` : "-", ancho: colRD },
                    { valor: (dia.hefd || 0) !== 0 ? `${dia.hefd}` : "-", ancho: colHEFD },
                    { valor: (dia.hefn || 0) !== 0 ? `${dia.hefn}` : "-", ancho: colHEFN }
                  ];

                  // Dibujar cada celda de la fila
                  datosColumnas.forEach((columna, colIndex) => {
                    // 1. Dibujar el rectángulo de fondo (alternando colores)
                    const colorFondo = diaIndex % 2 === 0 ? "#ffffff" : "#f9f9f9";

                    doc.rect(xPos, yActual, columna.ancho, rowHeight)
                      .fillAndStroke(colorFondo, "#E0E0E0");

                    // 2. Agregar texto centrado
                    doc
                      .font("Helvetica")
                      .fontSize(9)
                      .fillColor("#333333")
                      .text(
                        columna.valor.toString(),
                        xPos,
                        yActual + 6,
                        {
                          width: columna.ancho,
                          align: 'center'
                        }
                      );

                    xPos += columna.ancho;
                  });

                  yActual += rowHeight;
                });


              // Función helper para formatear totales
              function formatearTotal(valor) {
                if (valor === null || valor === undefined || valor === 0) {
                  return "-";
                }
                // Si es número, formatear con decimales si es necesario
                return typeof valor === 'number' ? valor.toFixed(1) : valor.toString();
              }

              // 1. Encabezado de totales
              const totalHeaderHeight = 25;
              doc.rect(40, yActual, tableWidth, totalHeaderHeight)
                .fillAndStroke("#F3F8F5", "#E0E0E0")

              doc
                .font("Helvetica-Bold")
                .fontSize(11)
                .fillColor("#2E8B57")
                .text("TOTALES CONSOLIDADOS", 40, yActual + 8, {
                  width: tableWidth,
                  align: 'center'
                });

              yActual += totalHeaderHeight;

              // 2. Fila de datos de totales
              let positionX = 40;
              const rowHeight = 22;

              const totalesData = [
                formatearTotal(grupo.totales.total_dias),
                "-",
                formatearTotal(grupo.totales.total_horas),
                formatearTotal(grupo.totales.total_hed),
                formatearTotal(grupo.totales.total_rn),
                formatearTotal(grupo.totales.total_hen),
                formatearTotal(grupo.totales.total_rd),
                formatearTotal(grupo.totales.total_hefd),
                formatearTotal(grupo.totales.total_hefn)
              ];

              const anchosColumnas = [colDia, colHorario, colHoras, colHED, colRN, colHEN, colRD, colHEFD, colHEFN];

              totalesData.forEach((total, colIndex) => {
                // Fondo ligeramente diferente para totales
                doc.rect(positionX, yActual, anchosColumnas[colIndex], rowHeight)
                  .fillAndStroke("#ffffff", "#E0E0E0");

                // Texto en negrita para totales
                doc
                  .font("Helvetica-Bold")
                  .fontSize(10)
                  .fillColor("#2E8B57")
                  .text(
                    total,
                    positionX + 2,
                    yActual + 6,
                    {
                      width: anchosColumnas[colIndex] - 4,
                      align: 'center'
                    }
                  );

                positionX += anchosColumnas[colIndex];
              });

              yActual += rowHeight; // Espacio extra después de totales

              // Solo mostrar si hay tipos de recargos
              if (grupo.tipos_recargos_consolidados && grupo.tipos_recargos_consolidados.length > 0) {
                // Calcular anchos de columnas para esta tabla
                const tipoRecargosWidth = tableWidth;
                const col1 = tipoRecargosWidth * 0.45; // TIPO RECARGO
                const col2 = tipoRecargosWidth * 0.10; // %
                const col3 = tipoRecargosWidth * 0.10; // V/BASE
                const col4 = tipoRecargosWidth * 0.10; // V/+ %
                const col5 = tipoRecargosWidth * 0.15; // CANTIDAD
                const col6 = tipoRecargosWidth * 0.10; // TOTAL

                // 1. Encabezado de tipos de recargos
                const headerHeight = 25;
                let xPos = 40;

                // Dibujar rectángulos del encabezado
                const encabezadosRecargos = [
                  { texto: 'TIPO RECARGO', ancho: col1 },
                  { texto: '%', ancho: col2 },
                  { texto: 'V/BASE', ancho: col3 },
                  { texto: 'V/+ %', ancho: col4 },
                  { texto: 'CANTIDAD', ancho: col5 },
                  { texto: 'TOTAL', ancho: col6 }
                ];

                encabezadosRecargos.forEach(encabezado => {
                  doc.rect(xPos, yActual, encabezado.ancho, headerHeight)
                    .fillAndStroke("#F3F8F5", "#E0E0E0")

                  doc
                    .font("Helvetica-Bold")
                    .fontSize(10)
                    .fillColor("#2E8B57")
                    .text(
                      encabezado.texto,
                      xPos + 3,
                      yActual + 8,
                      {
                        width: encabezado.ancho - 6,
                        align: encabezado.texto === 'TIPO RECARGO' ? 'left' : 'center'
                      }
                    );

                  xPos += encabezado.ancho;
                });

                yActual += headerHeight;

                // 2. Filas de tipos de recargos
                grupo.tipos_recargos_consolidados.forEach((tipo, tipoIndex) => {
                  xPos = 40;
                  const rowHeight = 20;

                  // Datos de la fila
                  const filaDatos = [
                    {
                      texto: `${tipo.nombre.toUpperCase()}${tipo.codigo !== "BONO_FESTIVO" ? ` - ${tipo.codigo}` : ''}`,
                      ancho: col1,
                      align: 'left',
                      color: '#333333'
                    },
                    {
                      texto: `${tipo.porcentaje}%`,
                      ancho: col2,
                      align: 'center',
                      color: '#333333'
                    },
                    {
                      texto: `$${Math.round(tipo.valor_hora_base).toLocaleString()}`,
                      ancho: col3,
                      align: 'center',
                      color: '#666666'
                    },
                    {
                      texto: `$${Math.round(tipo.valor_hora_con_recargo).toLocaleString()}`,
                      ancho: col4,
                      align: 'center',
                      color: '#2E8B57'
                    },
                    {
                      texto: tipo.horas.toString(),
                      ancho: col5,
                      align: 'center',
                      color: '#333333'
                    },
                    {
                      texto: `$${Math.round(tipo.valor_calculado).toLocaleString()}`,
                      ancho: col6,
                      align: 'center',
                      color: '#333333'
                    }
                  ];

                  // Dibujar cada celda
                  filaDatos.forEach((celda, colIndex) => {
                    doc.rect(xPos, yActual, celda.ancho, rowHeight)
                      .fillAndStroke("#ffffff", "#E0E0E0");

                    doc
                      .font(colIndex === 3 || colIndex === 5 ? "Helvetica-Bold" : "Helvetica")
                      .fontSize(10)
                      .fillColor(celda.color)
                      .text(
                        celda.texto,
                        xPos + 3,
                        yActual + 5,
                        {
                          width: celda.ancho - 6,
                          align: celda.align
                        }
                      );

                    xPos += celda.ancho;
                  });

                  yActual += rowHeight;
                });

                // 3. SUBTOTAL
                const subtotalHeight = 25;
                doc.rect(40, yActual, tipoRecargosWidth, subtotalHeight)
                  .fillAndStroke("#2E8B57", "#E0E0E0");

                doc
                  .font("Helvetica-Bold")
                  .fontSize(10)
                  .fillColor("#ffffff")
                  .text("SUBTOTAL", 43, yActual + 8)
                  .text(`$${Math.round(grupo.totales.valor_total).toLocaleString()}`, 40, yActual + 8, {
                    width: tipoRecargosWidth - 6,
                    align: 'right'
                  });

                yActual += subtotalHeight;

                // 4. Calcular valores adicionales
                const valorSeguridadSocial = Math.round(grupo.totales.valor_total * (grupo.configuracion_salarial?.seguridad_social || 0) / 100);
                const valorPrestacionesSociales = Math.round(grupo.totales.valor_total * (grupo.configuracion_salarial?.prestaciones_sociales || 0) / 100);
                const valorAdministracion = Math.round(grupo.totales.valor_total * (grupo.configuracion_salarial?.administracion || 0) / 100);
                const total = grupo.totales.valor_total + valorSeguridadSocial + valorPrestacionesSociales + valorAdministracion;

                // 5. Filas de conceptos adicionales
                const conceptosAdicionales = [
                  {
                    nombre: "SEGURIDAD SOCIAL",
                    porcentaje: grupo.configuracion_salarial?.seguridad_social || 0,
                    valor: valorSeguridadSocial
                  },
                  {
                    nombre: "PRESTACIONES SOCIALES",
                    porcentaje: grupo.configuracion_salarial?.prestaciones_sociales || 0,
                    valor: valorPrestacionesSociales
                  },
                  {
                    nombre: "ADMINISTRACIÓN",
                    porcentaje: grupo.configuracion_salarial?.administracion || 0,
                    valor: valorAdministracion
                  }
                ];

                conceptosAdicionales.forEach((concepto, index) => {
                  const rowHeight = 20;
                  doc.rect(40, yActual, tipoRecargosWidth, rowHeight)
                    .fillAndStroke("#ffffff", "#E0E0E0");

                  // Nombre del concepto
                  doc
                    .font("Helvetica")
                    .fontSize(10)
                    .fillColor("#333333")
                    .text(concepto.nombre, 43, yActual + 5, {
                      width: tipoRecargosWidth * 0.45
                    });

                  // Porcentaje
                  doc
                    .text(`${concepto.porcentaje}%`, 40 + (tipoRecargosWidth * 0.45), yActual + 5, {
                      width: tipoRecargosWidth * 0.10,
                      align: 'center'
                    });

                  // Valor
                  doc
                    .text(`$${concepto.valor.toLocaleString()}`, 40, yActual + 5, {
                      width: tipoRecargosWidth - 6,
                      align: 'right'
                    });

                  yActual += rowHeight;
                });

                // 6. TOTAL FINAL
                const totalHeight = 25;
                doc.rect(40, yActual, tipoRecargosWidth, totalHeight)
                  .fillAndStroke("#2E8B57", "#E0E0E0");

                doc
                  .font("Helvetica-Bold")
                  .fontSize(10)
                  .fillColor("#ffffff")
                  .text("TOTAL", 43, yActual + 8)
                  .text(`$${total.toLocaleString()}`, 40, yActual + 8, {
                    width: tipoRecargosWidth - 6,
                    align: 'right'
                  });

                yActual += totalHeight + 20; // Espacio extra al final
              }

            });

            // Información adicional en el pie de página
            doc
              .fontSize(9)
              .fillColor("#999999")
              .font("Helvetica")
              .text(
                `Total grupos en esta página: ${gruposPagina.length}`,
                40,
                doc.page.height - 60
              );

            // Total general si es la última página
            if (indicePagina === resultado.paginas.length - 1) {
              const totalGeneral = recargosAgrupados.reduce((total, grupo) => {
                const recargosArray = grupo.recargos || grupo.items || grupo.data || [];
                return total + recargosArray.reduce((subtotal, recargo) => {
                  const valor = recargo?.valor || recargo?.value || recargo?.amount || 0;
                  return subtotal + parseFloat(valor);
                }, 0);
              }, 0);

              doc
                .fontSize(12)
                .fillColor("#2E8B57")
                .font("Helvetica-Bold")
                .text(
                  `TOTAL GENERAL RECARGOS: ${formatToCOP(totalGeneral)}`,
                  40,
                  doc.page.height - 40,
                  {
                    align: 'right',
                    width: doc.page.width - 80
                  }
                );
            }
          });
        }
      } else {
        console.log('No se encontraron recargos agrupados para procesar');
      }

      // Finish the PDF
      doc.end();
    } catch (error) {
      console.error("Error generating PDF:", error);
      reject(error);
    }
  });
}

/**
 * Helper function to draw a table row
 * @param {PDFDocument} doc - The PDFKit document
 * @param {string} label - The row label
 * @param {string} value - The row value
 * @param {Object} options - Additional options
 */
function drawTableRow(doc, label, value, options = {}) {
  const {
    headerStyle = {},
    valueStyle = {},
    middleText = "",
    middleAlign = "left",
    valueAlign = "left",
    rowHeight = 26,
    drawBorder = true,
    isLastRow = false,
    drawVerticalBorders = false, // Nuevo parámetro para controlar bordes verticales
    borderStyle = "full", // Nuevo parámetro: "full", "horizontal", "outer", etc.
  } = options;

  const currentY = doc.y;
  const tableWidth = doc.page.width - 80;

  // Draw borders if needed
  if (drawBorder) {
    // Dibujar solo la línea horizontal superior
    doc
      .moveTo(40, currentY)
      .lineTo(40 + tableWidth, currentY)
      .stroke("#E0E0E0");

    // Dibujar la línea horizontal inferior (solo si no es la última fila)
    if (!isLastRow) {
      doc
        .moveTo(40, currentY + rowHeight)
        .lineTo(40 + tableWidth, currentY + rowHeight)
        .stroke("#E0E0E0");
    }

    // Dibujar líneas verticales solo si se solicita
    if (drawVerticalBorders) {
      if (middleText) {
        // Three-column layout
        const col1Width = tableWidth * 0.4;
        const col2Width = tableWidth * 0.3;

        // Línea vertical después de col1
        doc
          .moveTo(40 + col1Width, currentY)
          .lineTo(40 + col1Width, currentY + rowHeight)
          .stroke("#E0E0E0");

        // Línea vertical después de col2
        doc
          .moveTo(40 + col1Width + col2Width, currentY)
          .lineTo(40 + col1Width + col2Width, currentY + rowHeight)
          .stroke("#E0E0E0");
      } else {
        // Two-column layout
        const col1Width = tableWidth * 0.4;

        // Línea vertical después de col1
        doc
          .moveTo(40 + col1Width, currentY)
          .lineTo(40 + col1Width, currentY + rowHeight)
          .stroke("#E0E0E0");
      }

      // Líneas verticales en los bordes exteriores
      doc
        .moveTo(40, currentY)
        .lineTo(40, currentY + rowHeight)
        .stroke("#E0E0E0");
      doc
        .moveTo(40 + tableWidth, currentY)
        .lineTo(40 + tableWidth, currentY + rowHeight)
        .stroke("#E0E0E0");
    }
  }

  if (borderStyle === "full") {
    // Dibujar todos los bordes verticales (estilo original)
    if (middleText) {
      const col1Width = tableWidth * 0.4;
      const col2Width = tableWidth * 0.3;

      doc
        .moveTo(40 + col1Width, currentY)
        .lineTo(40 + col1Width, currentY + rowHeight)
        .stroke("#E0E0E0");
      doc
        .moveTo(40 + col1Width + col2Width, currentY)
        .lineTo(40 + col1Width + col2Width, currentY + rowHeight)
        .stroke("#E0E0E0");
    } else {
      const col1Width = tableWidth * 0.4;
      doc
        .moveTo(40 + col1Width, currentY)
        .lineTo(40 + col1Width, currentY + rowHeight)
        .stroke("#E0E0E0");
    }
  }

  // Siempre dibujar los bordes exteriores (izquierda y derecha)
  if (borderStyle === "outer" || borderStyle === "full") {
    // Borde izquierdo
    doc
      .moveTo(40, currentY)
      .lineTo(40, currentY + rowHeight)
      .stroke("#E0E0E0");
    // Borde derecho
    doc
      .moveTo(40 + tableWidth, currentY)
      .lineTo(40 + tableWidth, currentY + rowHeight)
      .stroke("#E0E0E0");
  }

  // Resto del código sin cambios...
  // Draw header text
  doc.fillColor("#000000").fontSize(12);
  if (headerStyle.bold) {
    doc.font("Helvetica-Bold");
  } else {
    doc.font("Helvetica");
  }

  if (headerStyle.fontSize) {
    doc.fontSize(headerStyle.fontSize);
  }

  doc.text(label, 48, currentY + 8);

  // Draw middle text if provided
  if (middleText) {
    doc.font("Helvetica").fontSize(12);

    const middleX = 40 + tableWidth * 0.4;
    const middleWidth = tableWidth * 0.3;

    if (middleAlign === "center") {
      doc.text(middleText, middleX, currentY + 8, {
        width: middleWidth,
        align: "center",
      });
    } else {
      doc.text(middleText, middleX + 8, currentY + 8);
    }
  }

  // Draw value text with custom styling
  if (valueStyle.bgColor) {
    // Calculate text width for background
    const textWidth = doc.widthOfString(value) + 16;
    const rightEdge = 40 + tableWidth;

    if (valueAlign === "right") {
      // Draw background rectangle for highlighting
      doc
        .roundedRect(
          rightEdge - textWidth - 8,
          currentY + 4,
          textWidth,
          rowHeight - 8,
          3
        )
        .fill(valueStyle.bgColor);
    }
  }

  if (valueStyle.color) {
    doc.fillColor(valueStyle.color);
  } else {
    doc.fillColor("#000000");
  }

  if (valueStyle.bold) {
    doc.font("Helvetica-Bold");
  } else {
    doc.font("Helvetica");
  }

  if (valueStyle.fontSize) {
    doc.fontSize(valueStyle.fontSize);
  } else {
    doc.fontSize(12);
  }

  if (valueAlign === "right") {
    // Aplicar margen derecho al texto si está especificado
    const marginRight = valueStyle.marginRight || 0;

    doc.text(value, 40, currentY + 8, {
      width: tableWidth - 8 - marginRight, // Restar el margen aquí
      align: "right",
    });
  } else if (valueAlign === "center") {
    // Para centrar el texto
    doc.text(value, 40, currentY + 8, {
      width: tableWidth,
      align: "center",
    });
  } else {
    const valueX = middleText ? 40 + tableWidth * 0.7 : 40 + tableWidth * 0.4;
    doc.text(value, valueX + 8, currentY + 8);
  }

  // Update document Y position
  doc.y = currentY + rowHeight;
}

const agruparRecargos = (
  recargo,
  configuraciones_salario,
) => {
  const grupos = {};

  // Función auxiliar para crear clave única
  const crearClave = (recargo) =>
    `${recargo.vehiculo.placa}-${recargo.mes}-${recargo.año}-${recargo.empresa.nit}`;

  // Función auxiliar para obtener configuración salarial
  const obtenerConfiguracion = (empresaId) => {
    if (!configuraciones_salario) {
      console.warn("No hay configuraciones de salario disponibles");

      return null;
    }

    // Buscar configuración específica de la empresa
    const configEmpresa = configuraciones_salario.find(
      (config) =>
        config.empresa_id === empresaId && config.activo === true,
    );

    if (configEmpresa) {
      return configEmpresa;
    }

    // Buscar configuración base del sistema
    const configBase = configuraciones_salario.find(
      (config) =>
        config.empresa_id === null && config.activo === true,
    );

    if (configBase) {
      return configBase;
    }

    return null;
  };

  // Función auxiliar para inicializar grupo
  const inicializarGrupo = (recargo) => {
    const configuracion = obtenerConfiguracion(recargo.empresa.id);

    if (!configuracion) return;

    const grupo = {
      vehiculo: recargo.vehiculo,
      mes: recargo.mes,
      año: recargo.año,
      empresa: recargo.empresa,
      recargos: [],
      configuracion_salarial: configuracion,
      valor_hora_base:
        configuracion.salario_basico / configuracion.horas_mensuales_base || 0,
      totales: {
        total_dias: 0,
        total_horas: 0,
        total_hed: 0,
        total_rn: 0,
        total_hen: 0,
        total_rd: 0,
        total_hefd: 0,
        total_hefn: 0,
        valor_total: 0,
        total_dias_festivos: 0,
        total_dias_domingos: 0,
      },
      dias_laborales_unificados: [],
      tipos_recargos_consolidados: [],
    };

    return grupo;
  };

  // Función auxiliar para procesar día laboral
  const procesarDiaLaboral = (grupo, dia) => {
    // Contar días especiales
    if (dia.es_festivo) {
      grupo.totales.total_dias_festivos++;
    }
    if (dia.es_domingo) {
      grupo.totales.total_dias_domingos++;
    }

    // Buscar si ya existe un día con la misma fecha
    const diaExistente = grupo.dias_laborales_unificados.find(
      (d) => d.dia === dia.dia,
    );

    if (diaExistente) {
      // Sumar horas al día existente
      const camposHoras = [
        "hed",
        "rn",
        "hen",
        "rd",
        "hefd",
        "hefn",
        "total_horas",
      ];

      camposHoras.forEach((campo) => {
        const valorAnterior = diaExistente[campo] || 0;
        const valorNuevo = dia[campo] || 0;

        diaExistente[campo] = valorAnterior + valorNuevo;
      });
    } else {
      // Agregar nuevo día con valores por defecto
      const nuevoDia = {
        ...dia,
        hed: dia.hed || 0,
        rn: dia.rn || 0,
        hen: dia.hen || 0,
        rd: dia.rd || 0,
        hefd: dia.hefd || 0,
        hefn: dia.hefn || 0,
      };

      grupo.dias_laborales_unificados.push(nuevoDia);
    }
  };

  // Función auxiliar para calcular valor por hora con recargo
  const calcularValorRecargo = (
    valorBase,
    porcentaje,
    horas,
    esAdicional,
    esValorFijo = false,
    valorFijo = 0,
  ) => {
    if (esValorFijo && valorFijo > 0) {
      const valorFijoRedondeado = Number(valorFijo);
      const valorHoraConRecargo = valorFijoRedondeado / horas; // Calcular valor por hora

      return {
        valorTotal: valorFijoRedondeado,
        valorHoraConRecargo: Number(valorHoraConRecargo),
      };
    }

    let valorHoraConRecargo;
    let valorTotal;

    if (esAdicional) {
      // MODO ADICIONAL: valor_hora * (1 + porcentaje/100)
      valorHoraConRecargo = valorBase * (1 + porcentaje / 100);

      // Redondear el valor por hora
      valorHoraConRecargo = Number(valorHoraConRecargo);
      valorTotal = valorHoraConRecargo * horas;
    } else {
      // MODO MULTIPLICATIVO: valor_hora * (porcentaje/100)
      valorHoraConRecargo = valorBase * (porcentaje / 100);

      // Redondear el valor por hora
      valorHoraConRecargo = Number(valorHoraConRecargo);
      valorTotal = valorHoraConRecargo * horas;
    }

    // Redondear también el valor total
    valorTotal = Number(valorTotal);

    return { valorTotal, valorHoraConRecargo };
  };

  const consolidarTipoRecargo = (grupo, tipo) => {
    const configSalarial = grupo.configuracion_salarial;
    const pagaDiasFestivos = configSalarial?.paga_dias_festivos || false;

    // Excluir recargos dominicales si la configuración paga días festivos
    if (pagaDiasFestivos && tipo.codigo === "RD") {
      return; // Saltar este tipo de recargo
    }

    const tipoExistente = grupo.tipos_recargos_consolidados.find(
      (t) => t.codigo === tipo.codigo,
    );

    const valorHoraBase = grupo.valor_hora_base;
    const porcentaje = tipo.porcentaje || 0;
    const horas = tipo.horas || 0;
    const esAdicional = tipo.adicional || false;

    const resultado = calcularValorRecargo(
      valorHoraBase,
      porcentaje,
      horas,
      esAdicional,
    );

    if (tipoExistente) {
      // Sumar horas y recalcular total
      tipoExistente.horas += horas;

      // Recalcular el valor total con las nuevas horas
      const nuevoResultado = calcularValorRecargo(
        valorHoraBase,
        porcentaje,
        tipoExistente.horas,
        esAdicional,
      );

      tipoExistente.valor_calculado = nuevoResultado.valorTotal;
      tipoExistente.valor_hora_con_recargo = nuevoResultado.valorHoraConRecargo;
      tipoExistente.adicional = esAdicional;
    } else {
      // Crear nuevo tipo de recargo
      const nuevoTipo = {
        ...tipo, // Spread todas las propiedades del tipo original
        codigo: tipo.codigo,
        nombre: tipo.nombre,
        porcentaje: porcentaje,
        horas: horas,
        valor_calculado: resultado.valorTotal,
        valor_hora_base: valorHoraBase,
        valor_hora_con_recargo: resultado.valorHoraConRecargo,
        adicional: esAdicional,
      };

      grupo.tipos_recargos_consolidados.push(nuevoTipo);
    }
  };

  // Función auxiliar para agregar bono festivo
  const agregarBonoFestivo = (grupo) => {
    const configSalarial = grupo.configuracion_salarial;
    const totalDiasEspeciales =
      grupo.totales.total_dias_festivos + grupo.totales.total_dias_domingos;

    if (!configSalarial?.paga_dias_festivos || totalDiasEspeciales === 0) {
      return;
    }

    const salarioBasico =
      parseFloat(configSalarial.salario_basico.toString()) || 0;
    const porcentajeFestivos =
      parseFloat(configSalarial.porcentaje_festivos?.toString() || "0") || 0;

    const valorDiarioBase = salarioBasico / 30;

    // FÓRMULA: valorDiarioBase * (porcentaje/100)
    const valorDiarioConRecargoTemp =
      valorDiarioBase * (porcentajeFestivos / 100);

    // Redondear el valor diario con recargo
    const valorDiarioConRecargo = Number(valorDiarioConRecargoTemp);

    const valorTotalDiasFestivos = totalDiasEspeciales * valorDiarioConRecargo;

    const bonoFestivo = {
      id: `bono_festivo_${grupo.empresa.nit}_${grupo.mes}_${grupo.año}`,
      codigo: "BONO_FESTIVO",
      nombre: "Bono Días Festivos/Dominicales",
      descripcion: "Bono por días festivos y dominicales trabajados",
      subcategoria: "bonos",
      porcentaje: porcentajeFestivos,
      adicional: false,
      es_valor_fijo: false,
      valor_fijo: null,
      aplica_festivos: true,
      aplica_domingos: true,
      aplica_nocturno: null,
      aplica_diurno: null,
      orden_calculo: 999,
      es_hora_extra: false,
      requiere_horas_extras: false,
      limite_horas_diarias: null,
      activo: true,
      vigencia_desde: new Date().toISOString(),
      vigencia_hasta: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      horas: totalDiasEspeciales,
      valor_hora_base: valorDiarioBase,
      valor_hora_con_recargo: valorDiarioConRecargo,
      valor_calculado: valorTotalDiasFestivos,
      es_bono_festivo: true,
    };

    grupo.tipos_recargos_consolidados.push(bonoFestivo);
  };

  // Función auxiliar para calcular totales finales
  const calcularTotalesFinales = (grupo) => {
    const configSalarial = grupo.configuracion_salarial;
    const pagaDiasFestivos = configSalarial?.paga_dias_festivos || false;

    // Calcular totales de horas por tipo
    const campos = ["hed", "rn", "hen", "hefd", "hefn"];

    campos.forEach((campo) => {
      const total = grupo.dias_laborales_unificados.reduce(
        (sum, dia) => sum + (dia[campo] || 0),
        0,
      );

      // Usar key assertion para acceso dinámico a propiedades
      (grupo.totales)[`total_${campo}`] = total;
    });

    // Solo sumar RD si NO se pagan días festivos
    grupo.totales.total_rd = pagaDiasFestivos
      ? 0
      : grupo.dias_laborales_unificados.reduce(
        (sum, dia) => sum + (dia.rd || 0),
        0,
      );

    // Agregar bono festivo si aplica
    agregarBonoFestivo(grupo);

    // Calcular valor total
    grupo.totales.valor_total = grupo.tipos_recargos_consolidados.reduce(
      (sum, tipo) => sum + tipo.valor_calculado,
      0,
    );

    // Ordenar resultados
    grupo.dias_laborales_unificados.sort(
      (a, b) => new Date(a.dia).getTime() - new Date(b.dia).getTime(),
    );

    grupo.tipos_recargos_consolidados.sort((a, b) => {
      if (a.es_bono_festivo) return 1;
      if (b.es_bono_festivo) return -1;

      return a.porcentaje - b.porcentaje;
    });
  };

  recargo.recargos.forEach((detalles) => {
    const clave = crearClave(detalles);

    // Crear grupo si no existe
    if (!grupos[clave]) {
      grupos[clave] = inicializarGrupo(detalles);
    }

    // Agregar detalles al grupo
    grupos[clave].recargos.push(detalles);

    // Acumular totales básicos
    grupos[clave].totales.total_dias += detalles.total_dias || 0;
    grupos[clave].totales.total_horas += detalles.total_horas || 0;

    // Procesar días laborales
    if (detalles.dias_laborales && detalles.dias_laborales.length > 0) {
      detalles.dias_laborales.forEach((dia) => {
        procesarDiaLaboral(grupos[clave], dia);

        // Procesar tipos de recargos del día
        if (dia.tipos_recargos && dia.tipos_recargos.length > 0) {
          dia.tipos_recargos.forEach((tipo) => {
            consolidarTipoRecargo(grupos[clave], tipo);
          });
        }
      });
    }
  });

  // Calcular totales finales para cada grupo
  Object.values(grupos).forEach((grupo, index) => {
    calcularTotalesFinales(grupo);
  });

  const resultado = Object.values(grupos);

  return resultado;
};

// Función para calcular la altura que ocupará un grupo en el PDF
const calcularAlturaGrupoPDF = (doc, grupo) => {
  let altura = 0;

  // Validar que el grupo existe y tiene la estructura esperada
  if (!grupo) {
    console.warn('Grupo undefined o null encontrado');
    return 50; // Altura mínima por seguridad
  }

  // Altura del título del grupo
  altura += 35; // Espacio para título del grupo con margen

  // Validar que existe la propiedad de recargos (puede ser 'recargos' o algún otro nombre)
  const recargosArray = grupo.recargos || grupo.items || grupo.data || [];

  // Validar que es un array
  if (!Array.isArray(recargosArray)) {
    console.warn('Los recargos no son un array:', grupo);
    return altura + 25; // Altura básica si no hay recargos válidos
  }

  // Altura de cada item en el grupo
  recargosArray.forEach(recargo => {
    if (!recargo) return; // Saltar items null/undefined

    // Altura base por item (considerando descripción)
    altura += 25;

    // Si la descripción es muy larga, agregar altura adicional
    const descripcion = recargo.descripcion || recargo.description || '';
    if (descripcion.length > 60) {
      const lineasExtra = Math.ceil((descripcion.length - 60) / 50);
      altura += lineasExtra * 15;
    }
  });

  // Espacio adicional entre grupos
  altura += 20;

  return altura;
};

// Función principal para agrupar contenido en páginas
const agruparEnPaginas = (doc, recargosAgrupados) => {
  // Validación inicial
  if (!recargosAgrupados || !Array.isArray(recargosAgrupados)) {
    console.warn('recargosAgrupados no es un array válido:', recargosAgrupados);
    return {
      paginas: [],
      totalPaginas: 0,
      resumen: {
        totalGrupos: 0,
        gruposPorPagina: []
      }
    };
  }

  // Filtrar grupos válidos
  const gruposValidos = recargosAgrupados.filter(grupo => {
    if (!grupo) return false;

    const recargosArray = grupo.recargos || grupo.items || grupo.data || [];
    return Array.isArray(recargosArray) && recargosArray.length > 0;
  });

  console.log(`Procesando ${gruposValidos.length} grupos válidos de ${recargosAgrupados.length} total`);

  if (gruposValidos.length === 0) {
    return {
      paginas: [],
      totalPaginas: 0,
      resumen: {
        totalGrupos: 0,
        gruposPorPagina: []
      }
    };
  }

  const paginas = [];
  let paginaActual = [];
  let alturaAcumulada = 100; // Margen superior + título principal
  const alturaMaximaPagina = 680; // Altura disponible considerando márgenes

  gruposValidos.forEach((grupo) => {
    const alturaGrupo = calcularAlturaGrupoPDF(doc, grupo);

    // Si agregar este grupo excede la altura de página
    if (
      alturaAcumulada + alturaGrupo > alturaMaximaPagina &&
      paginaActual.length > 0
    ) {
      // Cerrar página actual y comenzar nueva
      paginas.push([...paginaActual]);
      paginaActual = [grupo];
      alturaAcumulada = 100 + alturaGrupo; // Título de página + grupo actual
    } else {
      // Agregar a página actual
      paginaActual.push(grupo);
      alturaAcumulada += alturaGrupo;
    }
  });

  // Agregar última página si tiene contenido
  if (paginaActual.length > 0) {
    paginas.push([...paginaActual]);
  }

  return {
    paginas,
    totalPaginas: paginas.length,
    resumen: {
      totalGrupos: gruposValidos.length,
      gruposPorPagina: paginas.map(p => p.length)
    }
  };
};

// Función corregida para dibujar una fila de recargo
const drawRecargoRow = (doc, recargo, yPosition, isLast = false) => {
  const tableWidth = doc.page.width - 80;
  const col1Width = tableWidth * 0.6; // Descripción
  const col2Width = tableWidth * 0.2; // Días/Cantidad
  const col3Width = tableWidth * 0.2; // Valor
  const rowHeight = 25;

  // Validar que recargo existe
  if (!recargo) {
    console.warn('Recargo undefined encontrado');
    return yPosition + rowHeight;
  }

  // Dibujar bordes
  doc.rect(40, yPosition, col1Width, rowHeight).stroke("#E0E0E0");
  doc.rect(40 + col1Width, yPosition, col2Width, rowHeight).stroke("#E0E0E0");
  doc.rect(40 + col1Width + col2Width, yPosition, col3Width, rowHeight).stroke("#E0E0E0");

  // Contenido con validaciones
  const descripcion = recargo.descripcion || recargo.description || recargo.concepto || 'Sin descripción';
  const cantidad = recargo.dias || recargo.cantidad || recargo.qty || '';
  const valor = recargo.valor || recargo.value || recargo.amount || 0;

  doc
    .fillColor("#000000")
    .font("Helvetica")
    .fontSize(10)
    .text(descripcion, 45, yPosition + 8, {
      width: col1Width - 10,
      ellipsis: true
    });

  // Días o cantidad
  doc.text(cantidad.toString(), 40 + col1Width + 5, yPosition + 8, {
    width: col2Width - 10,
    align: 'center'
  });

  // Valor (usando la función formatToCOP que ya tienes)
  doc.text(formatToCOP(valor), 40 + col1Width + col2Width + 5, yPosition + 8, {
    width: col3Width - 10,
    align: 'center'
  });

  return yPosition + rowHeight;
};

const formatToCOP = (amount) => {
  if (typeof amount === "string") {
    amount = parseFloat(amount);
  }
  return `$ ${amount.toLocaleString("es-CO")}`;
};