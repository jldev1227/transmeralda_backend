// src/controllers/emailController.js
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");

// Almacén de trabajos activos en memoria
// En producción, considera usar Redis o una base de datos
const activeJobs = new Map();

class EmailController {
  /**
   * Inicia un trabajo de envío de correos masivos y devuelve un ID para seguimiento
   * @param {Request} req - Objeto de solicitud Express
   * @param {Response} res - Objeto de respuesta Express
   */
  async sendMassEmails(req, res) {
    const { emailData, pdfBlobs } = req.body;

    // Validar datos requeridos
    if (
      !emailData ||
      !emailData.subject ||
      !emailData.body ||
      !emailData.recipients ||
      !pdfBlobs ||
      !pdfBlobs.length
    ) {
      return res.status(400).json({
        success: false,
        message: "Datos incompletos para el envío de correos.",
      });
    }

    try {
      // Obtener el ID de usuario desde la solicitud (asumiendo que viene del middleware de autenticación)
      const userId = req.usuario?.id || req.user?.id || 'anonymous';
      
      // Crear un ID para el trabajo
      const jobId = uuidv4();
      
      // Registrar el trabajo
      activeJobs.set(jobId, {
        userId,
        status: 'queued',
        progress: 0,
        startTime: new Date(),
        totalEmails: emailData.recipients.length,
        sentEmails: 0,
        failedEmails: 0,
        results: []
      });
      
      // Devolver respuesta inmediata con el ID del trabajo
      res.status(202).json({
        success: true,
        message: "Proceso de envío iniciado",
        jobId
      });
      
      // Ejecutar el proceso en segundo plano
      this.processEmailJob(jobId, userId, emailData, pdfBlobs, req.app);
      
    } catch (error) {
      console.error("Error al iniciar el envío de correos masivos:", error);
      return res.status(500).json({
        success: false,
        message: `Error al iniciar el envío de correos: ${error.message}`,
        error: error.toString(),
      });
    }
  }
  
  /**
   * Obtiene el estado actual de un trabajo de envío de correos
   * @param {Request} req - Objeto de solicitud Express
   * @param {Response} res - Objeto de respuesta Express
   */
  async getJobStatus(req, res) {
    const { jobId } = req.params;
    
    if (!jobId || !activeJobs.has(jobId)) {
      return res.status(404).json({
        success: false,
        message: "Trabajo no encontrado"
      });
    }
    
    const job = activeJobs.get(jobId);
    
    // Verificar que el trabajo pertenece al usuario (seguridad)
    const userId = req.usuario?.id || req.user?.id || 'anonymous';
    if (job.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "No tiene permiso para acceder a este trabajo"
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
        sentEmails: job.sentEmails,
        failedEmails: job.failedEmails,
        ...(job.completedTime && { completedTime: job.completedTime }),
        ...(job.error && { error: job.error })
      }
    });
  }

  /**
   * Procesa el trabajo de envío de correos en segundo plano
   * @param {string} jobId - ID del trabajo
   * @param {string} userId - ID del usuario
   * @param {Object} emailData - Datos del correo a enviar
   * @param {Array} pdfBlobs - Archivos PDF en formato blob
   * @param {Express.Application} app - Aplicación Express para acceder a io
   */
  async processEmailJob(jobId, userId, emailData, pdfBlobs, app) {
    // Obtener la función notifyUser del app
    const notifyUser = app.get('notifyUser');
    const job = activeJobs.get(jobId);
    
    // Actualizar estado a procesando
    job.status = 'processing';
    this.updateJobProgress(jobId, 0, userId, notifyUser);
    
    try {
      // Crear un directorio temporal para guardar los PDFs
      const tempDir = path.join(os.tmpdir(), jobId);
      fs.mkdirSync(tempDir, { recursive: true });

      // Guardar los blobs de PDF como archivos temporales
      const pdfFiles = [];
      for (let i = 0; i < pdfBlobs.length; i++) {
        const pdfData = pdfBlobs[i].data;
        const fileName = pdfBlobs[i].filename || `documento_${i + 1}.pdf`;
        const filePath = path.join(tempDir, fileName);

        // Convertir el blob (base64) a un archivo
        const buffer = Buffer.from(pdfData, "base64");
        fs.writeFileSync(filePath, buffer);

        pdfFiles.push({
          id: i,
          filename: fileName,
          path: filePath,
          // Extraer identificador del conductor del nombre del archivo
          conductorId: fileName.split("_").pop().replace(".pdf", ""),
        });
      }

      // Configurar el transporte de correo
      const transporterConfig = {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      };

      const transporter = nodemailer.createTransport(transporterConfig);

      // Enviar correos electrónicos a todos los destinatarios
      const { recipients, subject, body, cc, bcc } = emailData;
      const results = [];
      const failedEmails = [];

      // Actualizar el total de emails en el trabajo
      job.totalEmails = recipients.length;

      // Enviar correos en lotes para evitar sobrecargar el servidor SMTP
      const BATCH_SIZE = 5; // Reducido para más actualizaciones
      
      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];

        // Obtener el identificador del destinatario (si está disponible)
        const conductorId = recipient.split("|")[1] || `conductor_${i}`;

        // Filtrar solo los PDFs para este conductor
        const attachments = pdfFiles.filter((pdf, index) => {
          if (pdf.conductorId && pdf.conductorId === conductorId) {
            return true;
          }
          // Si no hay match por ID, usar el índice como fallback
          return index === i;
        });

        try {
          const mailOptions = {
            from: transporterConfig.auth.user,
            to: recipient.split("|")[0] || recipient,
            subject: subject,
            ...(emailData.isHtml ? { html: body } : { text: body }),
            attachments: attachments.map(file => ({
              filename: file.filename,
              path: file.path
            })),
          };

          if (cc) mailOptions.cc = cc;
          if (bcc) mailOptions.bcc = bcc;

          // Enviar el correo
          await transporter.sendMail(mailOptions);

          // Registrar éxito
          results.push({
            email: recipient,
            status: "success",
          });
          
          job.sentEmails++;
        } catch (error) {
          console.error(`Error al enviar email a ${recipient}:`, error);
          
          failedEmails.push({
            email: recipient,
            error: error.message,
          });
          
          results.push({
            email: recipient,
            status: "failed",
            error: error.message,
          });
          
          job.failedEmails++;
        }
        
        // Actualizar progreso cada correo o después de un lote
        const progress = Math.round(((i + 1) / recipients.length) * 100);
        if (i % BATCH_SIZE === 0 || i === recipients.length - 1) {
          this.updateJobProgress(jobId, progress, userId, notifyUser);
        }
        
        // Pequeña pausa para evitar sobrecarga
        if (i < recipients.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Guardar resultados completos
      job.results = results;
      
      // Limpiar archivos temporales
      this.cleanupTempFiles(pdfFiles, tempDir);
      
      // Marcar trabajo como completado
      job.status = 'completed';
      job.progress = 100;
      job.completedTime = new Date();
      
      // Notificar completado
      if (notifyUser) {
        notifyUser(userId, 'job:completed', {
          jobId,
          result: {
            totalEmails: recipients.length,
            sentEmails: job.sentEmails,
            failedEmails: job.failedEmails
          }
        });
      }
      
      console.log(`Trabajo ${jobId} completado: ${job.sentEmails}/${recipients.length} emails enviados`);
      
      // Programar eliminación del trabajo después de un tiempo
      setTimeout(() => {
        activeJobs.delete(jobId);
      }, 30 * 60 * 1000); // 30 minutos
      
    } catch (error) {
      console.error(`Error en el procesamiento del trabajo ${jobId}:`, error);
      
      // Actualizar estado a fallido
      job.status = 'failed';
      job.error = error.message || 'Error desconocido';
      
      // Notificar error
      if (notifyUser) {
        notifyUser(userId, 'job:failed', {
          jobId,
          error: job.error
        });
      }
      
      // Programar eliminación del trabajo después de un tiempo
      setTimeout(() => {
        activeJobs.delete(jobId);
      }, 30 * 60 * 1000); // 30 minutos
    }
  }
  
  /**
   * Actualiza el progreso de un trabajo y notifica al usuario
   * @param {string} jobId - ID del trabajo
   * @param {number} progress - Porcentaje de progreso (0-100)
   * @param {string} userId - ID del usuario
   * @param {Function} notifyUser - Función para notificar al usuario
   */
  updateJobProgress(jobId, progress, userId, notifyUser) {
    const job = activeJobs.get(jobId);
    if (!job) return;
    
    job.progress = progress;
    
    // Notificar al usuario si está disponible
    if (notifyUser) {
      notifyUser(userId, 'job:progress', {
        jobId,
        progress,
        sentEmails: job.sentEmails,
        failedEmails: job.failedEmails,
        totalEmails: job.totalEmails
      });
    }
  }
  
  /**
   * Limpia los archivos temporales
   * @param {Array} pdfFiles - Archivos PDF
   * @param {string} tempDir - Directorio temporal
   */
  cleanupTempFiles(pdfFiles, tempDir) {
    // Limpiar archivos temporales
    pdfFiles.forEach((file) => {
      try {
        fs.unlinkSync(file.path);
      } catch (error) {
        console.warn(
          `No se pudo eliminar el archivo temporal: ${file.path}`,
          error
        );
      }
    });

    // Intentar eliminar el directorio temporal
    try {
      fs.rmdirSync(tempDir);
    } catch (error) {
      console.warn(
        `No se pudo eliminar el directorio temporal: ${tempDir}`,
        error
      );
    }
  }
}

module.exports = new EmailController();