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
        // Generar PDF para la liquidación
        const pdfBuffer = await generatePDF(liquidacion);

        // Verificar que el buffer es válido
        if (!Buffer.isBuffer(pdfBuffer)) {
          console.error(
            `Error: El PDF generado para liquidación ${liquidacion.id} no es un Buffer válido`
          );
          throw new Error("El PDF generado no es válido");
        }

        // Verificar tamaño y contenido
        if (pdfBuffer.length <= 10) {
          console.error(
            `Error: El PDF generado para liquidación ${liquidacion.id} está vacío o demasiado pequeño`
          );
          throw new Error("El PDF generado está vacío o es muy pequeño");
        }

        pdfBuffers.push({
          data: pdfBuffer,
          filename: `${liquidacion.conductor?.numero_identificacion || ""}_${liquidacion.id}_${getMesyAño(liquidacion.periodo_end)}.pdf`,
          conductorId: liquidacion.conductor?.id,
          email: liquidacion.conductor?.email,
        });
      } catch (pdfError) {
        console.error(
          `Error al generar PDF para liquidación ${liquidacion.id}:`,
          pdfError
        );
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

      const formatToCOP = (amount) => {
        if (typeof amount === "string") {
          amount = parseFloat(amount);
        }
        return `$ ${amount.toLocaleString("es-CO")}`;
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
        .text("TRANSPORTES Y SERVICIOS ESMERALDA S.A.S ZOMAC", {
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
      const col1Width = tableWidth * 0.3; // Reduce ligeramente
      const col2Width = tableWidth * 0.35; // Aumenta
      const col3Width = tableWidth * 0.175;
      const col4Width = tableWidth * 0.175; // Asegura que sea suficiente

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
          .text(observation, 40 + col1Width + 8, currentY + 6, {
            width: col2Width - 16,
            align: "left",
            lineGap: 2,
          });

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
        "",
        recargosActualizados?.length || "0",
        formatToCOP(
          totalRecargosParex !== undefined &&
            liquidacion.total_recargos !== undefined
            ? liquidacion.total_recargos - totalRecargosParex
            : liquidacion.total_recargos || 0
        )
      );

      // Recargos PAREX if any
      if (recargosParex.length > 0) {
        const isLastRow =
          !liquidacion.pernotes || liquidacion.pernotes.length === 0;

        drawConceptRow(
          "Recargos PAREX",
          "",
          recargosParex.length,
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
