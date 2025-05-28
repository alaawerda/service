const express = require('express');
const router = express.Router();
const balanceService = require('./services/balanceService');
const { Expo, ExpoPushToken } = require('expo-server-sdk');
const notificationConfig = require('./config/notifications');

// Utiliser l'instance Expo configurée
const expo = notificationConfig.expo;

// Fonction utilitaire pour valider les tokens Expo
function isValidExpoPushToken(token) {
  return ExpoPushToken.isValid(token);
}

// Fonction pour générer un code unique pour l'événement
const generateUniqueEventCode = () => {
  const prefix = 'EV';
  const timestamp = Date.now().toString(36);
  const randomNum = Math.floor(Math.random() * 1000).toString(36);
  return `${prefix}${timestamp}${randomNum}`.toUpperCase();
};

// Fonction simplifiée pour retourner des valeurs par défaut (obsolète, à conserver pour compatibilité)
const getDefaultBalances = () => {
  return {
    debts: [],
    total_to_pay: 0,
    total_to_receive: 0
  };
};

// balanceService is already an instance because of how it's exported
const balanceServiceInstance = balanceService;

// Logger class for server-side push notifications
class ServerNotificationLogger {
  constructor() {
    if (ServerNotificationLogger.instance) {
      return ServerNotificationLogger.instance;
    }
    this.logs = [];
    this.MAX_LOGS = 1000;
    ServerNotificationLogger.instance = this;
  }

  formatLog(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data,
      environment: process.env.NODE_ENV
    };
    const logString = JSON.stringify(logEntry);
    this.logs.push(logString);
    
    if (this.logs.length > this.MAX_LOGS) {
      this.logs = this.logs.slice(-this.MAX_LOGS);
    }
    
    return logString;
  }

  info(message, data) {
    const logString = this.formatLog('INFO', message, data);
    console.log('🔔 [SERVER INFO]', message, data || '');
    return logString;
  }

  debug(message, data) {
    const logString = this.formatLog('DEBUG', message, data);
    console.log('🔍 [SERVER DEBUG]', message, data || '');
    return logString;
  }

  warn(message, data) {
    const logString = this.formatLog('WARN', message, data);
    console.warn('⚠️ [SERVER WARN]', message, data || '');
    return logString;
  }

  error(message, error) {
    const logString = this.formatLog('ERROR', message, error);
    console.error('❌ [SERVER ERROR]', message, error || '');
    return logString;
  }

  getLogs() {
    return [...this.logs];
  }

  clearLogs() {
    this.logs = [];
  }
}

const serverLogger = new ServerNotificationLogger();

// Fonction utilitaire pour envoyer des notifications push
async function sendPushNotification(pushMessage) {
  try {
    serverLogger.info('Attempting to send push notification', {
      to: pushMessage.to,
      title: pushMessage.title,
      type: pushMessage.data?.type,
      timestamp: new Date().toISOString()
    });

    // Vérifier que le token est valide
    if (!Expo.isExpoPushToken(pushMessage.to)) {
      serverLogger.error('Invalid Expo push token', { token: pushMessage.to });
      return false;
    }

    const chunks = expo.chunkPushNotifications([pushMessage]);
    let notificationSent = false;

    serverLogger.debug('Processing push notification chunks', { 
      numberOfChunks: chunks.length,
      messageSize: JSON.stringify(pushMessage).length
    });

    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        serverLogger.info('Push notification tickets received', { 
          tickets,
          chunkSize: chunk.length
        });

        // Vérifier les erreurs dans les tickets
        const errors = tickets.filter(ticket => ticket.status === 'error');
        if (errors.length > 0) {
          serverLogger.error('Push notification errors in tickets', { 
            errors,
            chunkIndex: chunks.indexOf(chunk)
          });
        } else {
          notificationSent = true;
          serverLogger.info('Successfully sent push notification chunk', {
            chunkIndex: chunks.indexOf(chunk),
            tickets
          });
        }
      } catch (error) {
        serverLogger.error('Error sending push notification chunk', {
          error: error.message,
          chunkIndex: chunks.indexOf(chunk),
          stack: error.stack
        });
      }
    }

    if (notificationSent) {
      serverLogger.info('Push notification process completed successfully', {
        messageId: pushMessage.data?.messageId,
        recipientToken: pushMessage.to
      });
    } else {
      serverLogger.warn('Push notification process completed with errors', {
        messageId: pushMessage.data?.messageId,
        recipientToken: pushMessage.to
      });
    }

    return notificationSent;
  } catch (error) {
    serverLogger.error('Critical error in sendPushNotification', {
      error: error.message,
      stack: error.stack,
      message: pushMessage
    });
    return false;
  }
}

// Create the router function
const createRouter = (db) => {

// Routes pour les informations bancaires

// GET: Récupérer toutes les informations bancaires d'un utilisateur
router.get('/api/banking-info', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const bankingInfoResults = await db.query(
      'SELECT id, type, account_details, other_name, is_default FROM banking_info WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
      [userId]
    );

    res.json(bankingInfoResults || []);
  } catch (error) {
    console.error('Error fetching banking info:', error);
    res.status(500).json({ error: 'Server error while fetching banking information' });
  }
});

// POST: Ajouter une nouvelle information bancaire
router.post('/api/banking-info', async (req, res) => {
  try {
    const { userId, type, accountDetails, otherName, isDefault } = req.body;
    
    if (!userId || !type || !accountDetails) {
      return res.status(400).json({ error: 'User ID, type, and account details are required' });
    }

    // Si isDefault est true, mettre les autres entrées à false
    if (isDefault) {
      await db.query('UPDATE banking_info SET is_default = false WHERE user_id = ?', [userId]);
    }

    const result = await db.query(
      'INSERT INTO banking_info (user_id, type, account_details, other_name, is_default) VALUES (?, ?, ?, ?, ?)',
      [userId, type, accountDetails, otherName || null, isDefault || false]
    );

    res.json({ 
      id: result.insertId,
      success: true, 
      message: 'Banking information added successfully' 
    });
  } catch (error) {
    console.error('Error adding banking info:', error);
    res.status(500).json({ error: 'Server error while adding banking information' });
  }
});

// PUT: Mettre à jour une information bancaire existante
router.put('/api/banking-info/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { accountDetails, otherName, isDefault } = req.body;
    const { userId } = req.query;

    if (!id || !userId) {
      return res.status(400).json({ error: 'Banking info ID and User ID are required' });
    }

    // Vérifier que l'information bancaire appartient à l'utilisateur
    const ownerCheckResult = await db.query('SELECT user_id FROM banking_info WHERE id = ?', [id]);
    if (!ownerCheckResult || ownerCheckResult.length === 0) {
      return res.status(404).json({ error: 'Banking information not found' });
    }
    if (ownerCheckResult[0].user_id != userId) {
      return res.status(403).json({ error: 'You do not have permission to update this banking information' });
    }

    // Si isDefault est true, mettre les autres entrées à false
    if (isDefault) {
      await db.query('UPDATE banking_info SET is_default = false WHERE user_id = ?', [userId]);
    }

    await db.query(
      'UPDATE banking_info SET account_details = ?, other_name = ?, is_default = ? WHERE id = ?',
      [accountDetails, otherName || null, isDefault || false, id]
    );

    res.json({ success: true, message: 'Banking information updated successfully' });
  } catch (error) {
    console.error('Error updating banking info:', error);
    res.status(500).json({ error: 'Server error while updating banking information' });
  }
});

// DELETE: Supprimer une information bancaire
router.delete('/api/banking-info/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    if (!id || !userId) {
      return res.status(400).json({ error: 'Banking info ID and User ID are required' });
    }

    // Vérifier que l'information bancaire appartient à l'utilisateur
    const ownerCheckResult = await db.query('SELECT user_id, is_default FROM banking_info WHERE id = ?', [id]);
    if (!ownerCheckResult || ownerCheckResult.length === 0) {
      return res.status(404).json({ error: 'Banking information not found' });
    }
    if (ownerCheckResult[0].user_id != userId) {
      return res.status(403).json({ error: 'You do not have permission to delete this banking information' });
    }

    await db.query('DELETE FROM banking_info WHERE id = ?', [id]);

    // Si l'entrée supprimée était celle par défaut, définir une autre entrée comme défaut si elle existe
    if (ownerCheckResult[0].is_default) {
      const remainingEntries = await db.query('SELECT id FROM banking_info WHERE user_id = ? LIMIT 1', [userId]);
      if (remainingEntries && remainingEntries.length > 0) {
        await db.query('UPDATE banking_info SET is_default = true WHERE id = ?', [remainingEntries[0].id]);
      }
    }

    res.json({ success: true, message: 'Banking information deleted successfully' });
  } catch (error) {
    console.error('Error deleting banking info:', error);
    res.status(500).json({ error: 'Server error while deleting banking information' });
  }
});

// Routes pour les demandes de remboursement

// GET: Récupérer toutes les demandes de remboursement pour un utilisateur (reçues et envoyées)
router.get('/api/reimbursement-requests', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Récupérer les demandes où l'utilisateur est le demandeur ou le débiteur
    const requestsQuery = `
      SELECT rr.*, 
             e.name as event_name, 
             requester.username as requester_username,
             debtor.username as debtor_username,
             CASE 
               WHEN rr.requester_id = ? THEN 'sent' 
               WHEN rr.debtor_id = ? THEN 'received' 
             END as direction
      FROM reimbursement_requests rr
      JOIN events e ON rr.event_id = e.id
      JOIN users requester ON rr.requester_id = requester.id
      JOIN users debtor ON rr.debtor_id = debtor.id
      WHERE rr.requester_id = ? OR rr.debtor_id = ?
      ORDER BY rr.created_at DESC
    `;
    
    const requests = await db.query(requestsQuery, [userId, userId, userId, userId]);
    
    // Récupérer les informations bancaires pour les méthodes de paiement
    // qui correspondent au type d'information bancaire (en minuscules)
    const bankingInfos = await db.query(
      'SELECT id, type, account_details, other_name, is_default FROM banking_info WHERE user_id = ?',
      [userId]
    );
    
    // Enrichir les demandes avec les informations bancaires correspondantes
    const enrichedRequests = requests.map(request => {
      const result = { ...request };
      
      // Si l'utilisateur est le demandeur (requester) et qu'il a une méthode de paiement spécifiée
      if (request.requester_id == userId && request.payment_method) {
        // Rechercher une information bancaire dont le type correspond à la méthode de paiement (en minuscules)
        const matchingBankingInfo = bankingInfos.find(info => 
          info.type.toLowerCase() === request.payment_method.toLowerCase() ||
          (info.type === 'other' && info.other_name && 
           info.other_name.toLowerCase() === request.payment_method.toLowerCase())
        );
        
        if (matchingBankingInfo) {
          result.banking_info = {
            id: matchingBankingInfo.id,
            type: matchingBankingInfo.type,
            account_details: matchingBankingInfo.account_details,
            other_name: matchingBankingInfo.other_name,
            is_default: matchingBankingInfo.is_default
          };
        }
      }
      
      return result;
    });
    
    res.json(enrichedRequests);
  } catch (error) {
    console.error('Error fetching reimbursement requests:', error);
    res.status(500).json({ error: 'Server error while fetching reimbursement requests' });
  }
});

// POST: Créer une nouvelle demande de remboursement
router.post('/api/reimbursement-requests', async (req, res) => {
  try {
    const { eventId, debtorId, amount, currency, message, paymentMethod, paymentDetails } = req.body;
    const { userId } = req.query;
    
    if (!userId || !eventId || !debtorId || !amount || !currency) {
      return res.status(400).json({ 
        error: 'User ID, event ID, debtor ID, amount, and currency are required'
      });
    }
    
    // Récupérer les informations complètes pour les notifications
    const requestDetailQuery = `
      SELECT 
        u.username as requester_username,
        d.username as debtor_username,
        e.name as event_name
      FROM users u, users d, events e
      WHERE u.id = ? AND d.id = ? AND e.id = ?
    `;
    
    const requestDetails = await db.query(requestDetailQuery, [userId, debtorId, eventId]);
    
    if (!requestDetails || requestDetails.length === 0) {
      return res.status(404).json({ error: 'User, debtor or event not found' });
    }
    
    const requestInfo = requestDetails[0];
    
    // Insérer la demande de remboursement
    const result = await db.query(
      'INSERT INTO reimbursement_requests (event_id, requester_id, debtor_id, amount, currency, message, payment_method, payment_details, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [eventId, userId, debtorId, amount, currency, message || null, paymentMethod || null, paymentDetails || null, 'pending']
    );
    
    // Créer et envoyer une notification pour la nouvelle demande
    try {
      const notificationType = 'debt_request';
      const title = 'New Reimbursement Request';
      const body = `${requestInfo.requester_username} has requested a reimbursement of ${amount} ${currency} from you for ${requestInfo.event_name}.`;
      
      // Créer la notification en base de données
      const notificationInsertQuery = `
        INSERT INTO notifications (
          user_id, title, message, type, action_user_id, action_user_name,
          amount, currency, event_id, event_name, reference_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const referenceData = {
        requestId: result.insertId,
        originalType: 'request',
        timestamp: new Date().toISOString(),
        eventId: eventId,
        debtorId: debtorId,
        requesterId: userId
      };
      
      await db.query(notificationInsertQuery, [
        debtorId, // Le débiteur reçoit la notification
        title,
        body,
        notificationType,
        userId, // L'utilisateur qui fait la demande (requester)
        requestInfo.requester_username,
        parseFloat(amount),
        currency,
        eventId,
        requestInfo.event_name,
        JSON.stringify(referenceData)
      ]);
      
      console.log(`✅ Request notification created in database for user ${debtorId}`);
      
      // Tenter d'envoyer une notification push
      try {
        console.log(`🔔 Attempting to send request push notification to user ${debtorId}`);
        
        const tokenResponse = await db.query(
          'SELECT token FROM device_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
          [debtorId]
        );
        
        if (tokenResponse && tokenResponse.length > 0) {
          const recipientToken = tokenResponse[0].token;
          console.log(`📱 Found device token for user ${debtorId}: ${recipientToken ? 'EXISTS' : 'NULL'}`);
          
          // Vérifier que le token est valide pour Expo
          if (expo.isExpoPushToken(recipientToken)) {
            const pushMessage = {
              to: recipientToken,
              sound: 'default',
              title,
              body,
              data: {
                type: notificationType,
                requestId: result.insertId,
                eventId: eventId,
                amount: amount,
                currency: currency,
                timestamp: new Date().toISOString(),
                requesterName: requestInfo.requester_username,
                eventName: requestInfo.event_name,
                paymentMethod: paymentMethod || null,
                message: message || null
              },
              priority: 'high',
              badge: 1,
              android: {
                color: '#2196F3', // Bleu pour les demandes
                channelId: 'default',
                priority: 'high',
                smallIcon: '@mipmap/ic_launcher',
                largeIcon: '@mipmap/ic_launcher'
              },
              ios: {
                icon: '@mipmap/ic_launcher'
              }
            };
            
            console.log('📤 SENDING REIMBURSEMENT REQUEST push notification:', {
              to: recipientToken,
              title,
              body,
              dataType: notificationType,
              recipientUserId: debtorId,
              requesterName: requestInfo.requester_username,
              amount,
              currency,
              eventName: requestInfo.event_name,
              messageData: pushMessage.data
            });
            
            const chunks = expo.chunkPushNotifications([pushMessage]);
            let notificationSent = false;
            
            for (const chunk of chunks) {
              try {
                const tickets = await expo.sendPushNotificationsAsync(chunk);
                console.log(`✅ Push notification sent for request to user ${debtorId}. Tickets:`, tickets);
                
                // Vérifier s'il y a des erreurs dans les tickets
                const errors = tickets.filter(ticket => ticket.status === 'error');
                if (errors.length > 0) {
                  console.error('❌ Push notification errors:', errors);
                } else {
                  notificationSent = true;
                  console.log('✅ REIMBURSEMENT REQUEST notification successfully sent to user:', debtorId);
                }
              } catch (pushError) {
                console.error('❌ Error sending push notification chunk:', pushError);
              }
            }
            
            // Log final pour confirmer l'envoi
            console.log(`📤 REIMBURSEMENT REQUEST notification final status: ${notificationSent ? 'SENT' : 'FAILED'} for user ${debtorId}`);
            
          } else {
            console.log(`❌ Invalid or missing Expo push token for user: ${debtorId}, Token: ${recipientToken}`);
          }
        } else {
          console.log(`ℹ️ No device token found for user: ${debtorId}`);
        }
      } catch (tokenError) {
        console.error('❌ Error fetching device token or sending push notification:', tokenError);
      }
      
    } catch (notificationError) {
      console.error(`❌ Error creating/sending request notification:`, notificationError);
      // Ne pas faire échouer la requête principale si la notification échoue
    }
    
    res.status(201).json({ 
      id: result.insertId,
      success: true, 
      message: 'Reimbursement request created successfully' 
    });
  } catch (error) {
    console.error('Error creating reimbursement request:', error);
    res.status(500).json({ error: 'Server error while creating reimbursement request' });
  }
});

// PUT: Mettre à jour le statut d'une demande de remboursement (approuver, rejeter, marquer comme complétée)
router.put('/api/reimbursement-requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, paymentDetails } = req.body;
    const { userId } = req.query;
    
    if (!id || !userId || !status) {
      return res.status(400).json({ error: 'Request ID, User ID, and status are required' });
    }
    
    // Vérifier que le statut est valide
    if (!['pending', 'approved', 'rejected', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    // Récupérer les informations complètes de la demande de remboursement pour les notifications
    const requestDetailQuery = `
      SELECT rr.*, 
             e.name as event_name, 
             requester.username as requester_username,
             debtor.username as debtor_username
      FROM reimbursement_requests rr
      JOIN events e ON rr.event_id = e.id
      JOIN users requester ON rr.requester_id = requester.id
      JOIN users debtor ON rr.debtor_id = debtor.id
      WHERE rr.id = ?
    `;
    
    const requestDetails = await db.query(requestDetailQuery, [id]);
    
    if (!requestDetails || requestDetails.length === 0) {
      return res.status(404).json({ error: 'Reimbursement request not found' });
    }
    
    const requestInfo = requestDetails[0];
    const { requester_id, debtor_id } = requestInfo;
    
    // Vérifier les permissions selon le statut à mettre à jour
    if (status === 'approved' || status === 'rejected') {
      // Seul le débiteur peut approuver ou rejeter une demande
      if (userId != debtor_id) {
        return res.status(403).json({ 
          error: 'Only the debtor can approve or reject a reimbursement request' 
        });
      }
    } else if (status === 'completed') {
      // Seul le demandeur peut marquer une demande comme complétée
      if (userId != requester_id) {
        return res.status(403).json({ 
          error: 'Only the requester can mark a reimbursement request as completed' 
        });
      }
    }
    
    // Mise à jour du statut et éventuellement des détails de paiement
    let query = 'UPDATE reimbursement_requests SET status = ?';
    let params = [status];
    
    if (paymentDetails && status === 'approved') {
      query += ', payment_details = ?';
      params.push(paymentDetails);
    }
    
    query += ' WHERE id = ?';
    params.push(id);
    
    await db.query(query, params);
    
    // Créer et envoyer une notification pour les rejets (et approbations)
    if (status === 'rejected' || status === 'approved') {
      try {
        const notificationType = status === 'rejected' ? 'debt_rejection' : 'debt_approval';
        const title = status === 'rejected' ? 
          (req.body.actionType === 'reject_payment' ? 'Payment Rejected' : 'Reimbursement Request Rejected') : 
          'Reimbursement Approved';
        const body = status === 'rejected' 
          ? `${requestInfo.debtor_username} has rejected your reimbursement request of ${requestInfo.amount} ${requestInfo.currency} for ${requestInfo.event_name}.`
          : `${requestInfo.debtor_username} has approved your reimbursement request of ${requestInfo.amount} ${requestInfo.currency} for ${requestInfo.event_name}.`;
        
        // Log spécial pour les rejets
        if (status === 'rejected') {
          console.log('🔴 PROCESSING REJECTION notification:', {
            requestId: id,
            requesterUserId: requestInfo.requester_id,
            debtorUserId: requestInfo.debtor_id,
            debtorUsername: requestInfo.debtor_username,
            amount: requestInfo.amount,
            currency: requestInfo.currency,
            eventName: requestInfo.event_name,
            title,
            body,
            notificationType
          });
        }
        
        // Vérifier que nous avons un destinataire valide
        if (!requestInfo.requester_id) {
          console.error(`❌ Cannot send ${status} notification: missing requester_id`);
          throw new Error(`Missing requester_id for ${status} notification`);
        }
        
        // Créer la notification en base de données
        const notificationInsertQuery = `
          INSERT INTO notifications (
            user_id, title, message, type, action_user_id, action_user_name,
            amount, currency, event_id, event_name, reference_data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const referenceData = {
          requestId: id,
          originalType: status,
          timestamp: new Date().toISOString(),
          eventId: requestInfo.event_id,
          debtorId: requestInfo.debtor_id,
          requesterId: requestInfo.requester_id,
          actionType: req.body.actionType || 'reject_request'
        };
        
        await db.query(notificationInsertQuery, [
          requestInfo.requester_id,
          title,
          body,
          notificationType,
          requestInfo.debtor_id,
          requestInfo.debtor_username,
          parseFloat(requestInfo.amount),
          requestInfo.currency,
          requestInfo.event_id,
          requestInfo.event_name,
          JSON.stringify(referenceData)
        ]);
        
        console.log(`✅ ${status} notification created in database for user ${requestInfo.requester_id}`);
        
        // Récupérer le token de l'appareil
        const tokenResponse = await db.query(
          'SELECT token FROM device_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
          [requestInfo.requester_id]
        );

        if (tokenResponse && tokenResponse.length > 0) {
          const recipientToken = tokenResponse[0].token;
          console.log(`📱 Found device token for user ${requestInfo.requester_id}: ${recipientToken ? 'EXISTS' : 'NULL'}`);

          if (recipientToken) {
            const pushMessage = {
              to: recipientToken,
              sound: 'default',
              title,
              body,
              data: {
                type: notificationType,
                requestId: id,
                eventId: requestInfo.event_id,
                amount: requestInfo.amount,
                currency: requestInfo.currency,
                timestamp: new Date().toISOString(),
                ...(status === 'rejected' && {
                  rejectedBy: requestInfo.debtor_username,
                  rejectedAt: new Date().toISOString(),
                  originalAmount: requestInfo.amount,
                  actionType: req.body.actionType || 'reject_request'
                })
              },
              priority: 'high',
              badge: 1,
              android: {
                color: status === 'rejected' ? '#F44336' : '#4CAF50',
                channelId: 'default',
                priority: 'high',
                smallIcon: '@mipmap/ic_launcher',
                largeIcon: '@mipmap/ic_launcher'
              },
              ios: {
                icon: '@mipmap/ic_launcher'
              }
            };

            // Utiliser la nouvelle fonction d'envoi de notification
            const notificationSent = await sendPushNotification(pushMessage);

            if (status === 'rejected') {
              console.log(`🔴 REJECTION notification final status: ${notificationSent ? 'SENT' : 'FAILED'} for user ${requestInfo.requester_id}`);
            }
          } else {
            console.log(`❌ Invalid or missing Expo push token for user: ${requestInfo.requester_id}`);
          }
        } else {
          console.log(`ℹ️ No device token found for user: ${requestInfo.requester_id}`);
          if (status === 'rejected') {
            console.log('🔴 ⚠️ REJECTION notification could not be sent - no device token for user:', requestInfo.requester_id);
          }
        }
      } catch (error) {
        console.error(`❌ Error in notification process:`, error);
        // Ne pas faire échouer la requête principale si la notification échoue
      }
    }
    
    res.json({ 
      success: true, 
      message: `Reimbursement request ${status}` 
    });
  } catch (error) {
    console.error('Error updating reimbursement request:', error);
    res.status(500).json({ error: 'Server error while updating reimbursement request' });
  }
});

// DELETE: Supprimer une demande de remboursement (uniquement si elle est encore en attente)
router.delete('/api/reimbursement-requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    
    if (!id || !userId) {
      return res.status(400).json({ error: 'Request ID and User ID are required' });
    }
    
    // Vérifier que la demande existe et qu'elle est encore en attente
    const requestCheck = await db.query(
      'SELECT requester_id, status FROM reimbursement_requests WHERE id = ?',
      [id]
    );
    
    if (!requestCheck || requestCheck.length === 0) {
      return res.status(404).json({ error: 'Reimbursement request not found' });
    }
    
    const { requester_id, status } = requestCheck[0];
    
    // Vérifier que l'utilisateur est le demandeur
    if (userId != requester_id) {
      return res.status(403).json({ 
        error: 'Only the requester can delete a reimbursement request' 
      });
    }
    
    // Vérifier que la demande est encore en attente
    if (status !== 'pending') {
      return res.status(400).json({ 
        error: 'Only pending reimbursement requests can be deleted' 
      });
    }
    
    await db.query('DELETE FROM reimbursement_requests WHERE id = ?', [id]);
    
    res.json({ 
      success: true, 
      message: 'Reimbursement request deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting reimbursement request:', error);
    res.status(500).json({ error: 'Server error while deleting reimbursement request' });
  }
});

// API pour rejoindre un événement par code et lier un participant à l'utilisateur connecté
router.post('/api/join-event', async (req, res) => {
  try {
    const { userId, participantId } = req.body;
    if (!userId || !participantId) {
      return res.status(400).json({ error: 'Code et utilisateur requis' });
    }
    // Vérifier si le participant est déjà lié à un utilisateur
    const participantRows = await db.query('SELECT user_id, event_id, name FROM participants WHERE id = ?', [participantId]);
    if (!participantRows || participantRows.length === 0) {
      return res.status(404).json({ error: 'Participant introuvable' });
    }
    // Vérifier si ce user participe déjà à cet event
    const eventId = participantRows[0].event_id;
    const oldParticipantName = participantRows[0].name; // Store the old name before updating
    const alreadyParticipant = await db.query('SELECT id FROM participants WHERE event_id = ? AND user_id = ?', [eventId, userId]);
    if (alreadyParticipant && alreadyParticipant.length > 0) {
      return res.status(409).json({ error: 'Vous participez déjà à cet événement.' });
    }
    if (participantRows[0].user_id) {
      return res.status(409).json({ error: 'Ce participant est déjà lié à un utilisateur.' });
    }
    // Fetch the username for the given userId
    const userRows = await db.query('SELECT username FROM users WHERE id = ?', [userId]);
    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }
    const username = userRows[0].username;
    
    // Update the participant with the user_id and username
    await db.query('UPDATE participants SET user_id = ?, name = ? WHERE id = ?', [userId, username, participantId]);
    
    // Update all expenses in this event where paid_by matches the old participant name
    const updateExpensesResult = await db.query(
      'UPDATE expenses SET paid_by = ? WHERE event_id = ? AND paid_by = ?', 
      [username, eventId, oldParticipantName]
    );
    
    console.log(`[Join Event] Successfully updated participant ${participantId} and ${updateExpensesResult.affectedRows} expense(s) in event ${eventId}`);
    
    return res.json({ 
      success: true, 
      updatedExpenses: updateExpensesResult.affectedRows,
      message: `Participant updated and ${updateExpensesResult.affectedRows} expense(s) updated with new name` 
    });
    
  } catch (error) {
    console.error('Erreur join-event:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
  // Nouvelle route : récupérer les participants d'un événement par code
  router.get('/api/events/by-code/:eventCode/participants', async (req, res) => {
    try {
      const { eventCode } = req.params;
  
      //const eventResults = await db.query(eventQuery, [eventCode]);
      const eventResults = await db.query('SELECT* FROM events WHERE code = ?', [eventCode]);

      if (!eventResults || eventResults.length === 0) {
        return res.status(404).json({ error: "Événement introuvable" });
      }
      const eventId = eventResults[0].id;
      const eventName = eventResults[0].name;
      const participantsQuery = 'SELECT id, name, user_id FROM participants WHERE event_id = ?';
      const participants = await db.query(participantsQuery, [eventId]);
      res.json({ eventName, participants });
    } catch (error) {
      console.error("Erreur lors de la récupération des participants par code:", error);
      res.status(500).json({ error: "Erreur serveur lors de la récupération des participants" });
    }
  });

  // Nouvelle route pour récupérer tous les détails des événements d'un utilisateur
  router.get('/api/user-events-detailed', async (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      // 1. Trouver tous les event_id auxquels l'utilisateur participe
      const eventIdsResult = await db.query(
        'SELECT DISTINCT event_id FROM participants WHERE user_id = ?',
        [userId]
      );

      if (!eventIdsResult || eventIdsResult.length === 0) {
        return res.json([]); // Retourner un tableau vide si l'utilisateur ne participe à aucun événement
      }

      const eventIds = eventIdsResult.map(row => row.event_id);

      // 2. Pour chaque event_id, récupérer les détails nécessaires
      const detailedEventsPromises = eventIds.map(async (eventId) => {
        try {
          // Récupérer les infos de base de l'événement (incluant dates et code)
          const eventInfoResult = await db.query(
            'SELECT id, name, currency, start_date, end_date, created_at, code FROM events WHERE id = ?',
            [eventId]
          );
          if (!eventInfoResult || eventInfoResult.length === 0) {
            return null; // Ignorer si l'événement n'est pas trouvé
          }
          const eventInfo = eventInfoResult[0];

          // Compter les participants
          const [participantCountResult] = await db.query('SELECT COUNT(*) as count FROM participants WHERE event_id = ?', [eventId]);
          const participantCount = participantCountResult?.count ?? 0;

          // Compter les dépenses et calculer le montant total
          const [expenseStatsResult] = await db.query('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as totalAmount FROM expenses WHERE event_id = ?', [eventId]);
          const expenseCount = expenseStatsResult?.count ?? 0;
          const totalExpenseAmount = Number(expenseStatsResult?.totalAmount ?? 0);

          // Calculer myShareTotal
          const shareQuery = `
            SELECT COALESCE(SUM(ep.share_amount), 0) AS myShareTotal
            FROM expense_participants ep
            JOIN expenses e ON ep.expense_id = e.id
            JOIN participants p ON ep.participant_id = p.id
            WHERE e.event_id = ? AND p.user_id = ?
          `;
          const [shareRows] = await db.query(shareQuery, [eventId, userId]);
          const myShareTotal = Number(shareRows?.myShareTotal ?? 0);

          // Calculer les dettes et soldes
          const balances = await balanceServiceInstance.calculateDebts(eventId, userId);

          return {
            id: eventInfo.id,
            name: eventInfo.name,
            currency: eventInfo.currency,
            startDate: eventInfo.start_date, // Ajouté
            endDate: eventInfo.end_date,     // Ajouté
            created_at: eventInfo.created_at, // Ajouté
            code: eventInfo.code,           // Ajouté
            participants: [], // Placeholder, car on a juste le compte pour l'instant
            participantCount: participantCount, // Ajouté
            expenseCount: expenseCount,         // Ajouté
            totalExpenseAmount: totalExpenseAmount, // Ajouté
            myShareTotal: myShareTotal,
            total_to_pay: balances.total_to_pay,
            total_to_receive: balances.total_to_receive,
            debts: balances.debts ,// Inclure les détails des dettes
            status : balances.status,
            id_reimboursment : balances.id
          };
        } catch (error) {
          console.error(`Error fetching details for event ${eventId}:`, error);
          return null; // Retourner null en cas d'erreur pour cet événement spécifique
        }
      });

      const detailedEvents = (await Promise.all(detailedEventsPromises)).filter(event => event !== null);

      res.json(detailedEvents);

    } catch (error) {
      console.error('Error fetching detailed user events:', error);
      res.status(500).json({ error: 'Server error while fetching detailed user events' });
    }
  });

  // Get event details by ID
  router.get('/api/events/:eventId', async (req, res) => {
    try {
      const { eventId } = req.params;
      const userId = req.query.userId;
      
      const query = `
        SELECT
          e.*,
          GROUP_CONCAT(DISTINCT p.id) as participant_ids,
          GROUP_CONCAT(DISTINCT p.name) as participant_names,
          GROUP_CONCAT(DISTINCT p.custom_amount) as participant_amounts,
          (SELECT COUNT(*) FROM expenses WHERE event_id = e.id) as expenseCount,
          (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE event_id = e.id) as totalExpenseAmount
        FROM
          events e
          LEFT JOIN participants p ON e.id = p.event_id
        WHERE
          e.id = ?
        GROUP BY
          e.id
      `;

      // Utiliser l'API promise de mysql2 au lieu des callbacks
      const eventResults = await db.query(query, [eventId]);
      
      if (!eventResults || eventResults.length === 0) {
        console.log(`[Event Details] Event not found: ${eventId}`);
        return res.status(404).json({ error: 'Event not found' });
      }

      const event = eventResults[0];
      console.log(`[Event Details] Found event: ${event.id}, Participants: ${event.participant_names || 'none'}`);

      event.participants = event.participant_names
        ? event.participant_names.split(',').map((name, index) => ({
            id: event.participant_ids ? event.participant_ids.split(',')[index] : null,
            name,
            customAmount: event.participant_amounts
              ? event.participant_amounts.split(',')[index] || null
              : null
          }))
        : [];
      
      delete event.participant_ids;
      delete event.participant_names;
      delete event.participant_amounts;
      delete event.expense_amounts;
      delete event.paid_by_list;
      delete event.split_types;
      delete event.expense_participant_ids;
      delete event.expense_share_amounts;

      // Compute sum of share_amount for the logged-in user, default to 0 if missing
      const shareQuery = `
        SELECT COALESCE(SUM(ep.share_amount), 0) AS myShareTotal
        FROM expense_participants ep
        JOIN expenses e ON ep.expense_id = e.id
        JOIN participants p ON ep.participant_id = p.id
        WHERE e.event_id = ? AND p.user_id = ?
      `;
      const [shareRows] = await db.query(shareQuery, [eventId, userId]);
      // Debug shareRows and computed myShareTotal
      console.log('[Event Details] shareRows:', shareRows);
      console.log(`[Event Details] My Expenses total for user ${userId}:`, shareRows?.[0]?.myShareTotal);
      const myShareTotal =shareRows;
      console.log(`[Event Details] My Expenses total for user ${userId}:`, Number(shareRows?.myShareTotal ?? 0));
      event.myShareTotal = Number(shareRows?.myShareTotal ?? 0);

      // Récupérer les dépenses
      console.log('[Event Details] Fetching expenses for event:', eventId);
      const expensesQuery = `
        SELECT e.*, ep.participant_id, ep.share_amount, ep.he_participates
        FROM expenses e
        LEFT JOIN expense_participants ep ON e.id = ep.expense_id
        WHERE e.event_id = ?
        ORDER BY e.created_date DESC
      `;
      const expenses = await db.query(expensesQuery, [eventId]);
      
      // Calculer les dettes entre participants
      try {
        const balances = await balanceService.calculateDebts(eventId, userId);
        console.log(`[Event Details] Calculated balances for event: ${eventId}`, balances);
        // Assigner directement les dettes calculées, sans filtrage supplémentaire ici.
        // Le service balanceService.js s'occupe déjà de marquer les dettes comme remboursées.
        event.debts = balances.debts; 
        event.total_to_pay = balances.total_to_pay;
        event.total_to_receive = balances.total_to_receive;
      } catch (error) {
        console.error('[Event Details] Error calculating balances:', error);
        // En cas d'erreur, on continue avec des valeurs par défaut
        const defaultBalances = getDefaultBalances();
        event.debts = defaultBalances.debts;
        event.total_to_pay = defaultBalances.total_to_pay;
        event.total_to_receive = defaultBalances.total_to_receive;
      }

      event.expenses = expenses;
      res.json(event);

    } catch (error) {
      console.error('Server error:', error);
      if (error.message === 'Event not found') {
        res.status(404).json({ error: 'Event not found' });
      } else {
        res.status(500).json({ error: 'Server error' });
      }
    }
  });

  // Get event expenses
  router.get('/api/events/:eventId/expenses', async (req, res) => {
    try {
      const { eventId } = req.params;

      const query = `
       SELECT 
          e.*, 
          ep.participant_id, 
          ep.share_amount, 
          ep.he_participates,
          p.name AS participant_name
        FROM expenses e
        LEFT JOIN expense_participants ep ON e.id = ep.expense_id
        LEFT JOIN participants as p on ep.participant_id = p.id
        WHERE e.event_id = ?
        ORDER BY e.created_date DESC
      `;

      const results = await db.query(query, [eventId]);
      
      if (!results) {
        console.error('Database error: No results returned');
        return res.status(500).json({ error: 'Database error' });
      }

      const expenses = [];
      const expenseMap = new Map();

      results.forEach(row => {
        if (!expenseMap.has(row.id)) {
          const expense = {
            ...row,
            participants: []
          };
          delete expense.participant_id;
          delete expense.share_amount;
          expenseMap.set(row.id, expense);
          expenses.push(expense);
        }

        if (row.participant_id) {
          const expense = expenseMap.get(row.id);
          expense.participants.push({
            participant_id: row.participant_id,
            name: row.participant_name,
            share_amount: row.share_amount,
            he_participates: row.he_participates
          });
        }
      });

      // Log a summary instead of the full data
      console.log(`[Get Expenses] Retrieved ${expenses.length} expenses for event ${eventId}`);
      res.json(expenses);
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Get all events
  router.get('/api/events', async (req, res) => {
    try {
      const query = `
        SELECT e.*,
          GROUP_CONCAT(DISTINCT p.name) as participant_names,
          GROUP_CONCAT(DISTINCT p.custom_amount) as participant_amounts,
          COUNT(DISTINCT ex.id) as expenseCount,
          COALESCE(SUM(ex.amount) / NULLIF(COUNT(DISTINCT p.id), 0), 0) as totalExpenseAmount,
          GROUP_CONCAT(DISTINCT ex.amount) as expense_amounts,
          GROUP_CONCAT(DISTINCT ex.paid_by) as paid_by_list,
          GROUP_CONCAT(DISTINCT ex.split_type) as split_types
        FROM events e
        LEFT JOIN participants p ON e.id = p.event_id
        LEFT JOIN expenses ex ON e.id = ex.event_id
        GROUP BY e.id
        ORDER BY e.created_at DESC
      `;

      // Utiliser l'API promise de mysql2 au lieu des callbacks
      const results = await db.query(query, []);
      
      if (!results) {
        return res.status(500).json({ error: 'Database error' });
      }

      const events = results.map(event => {
        event.participants = event.participant_names
          ? event.participant_names.split(',').map((name, index) => ({
              name,
              customAmount: event.participant_amounts
                ? event.participant_amounts.split(',')[index] || null
                : null
            }))
          : [];

        // Calculate balances if there are expenses
        if (event.expense_amounts) {
          // Get userId from query parameter
          const userId = req.query.userId;
          const eventBalances = getDefaultBalances(event.participants, userId);

          // Utiliser les valeurs par défaut
          event.amountToPay = 0;
          event.amountToReceive = 0;
        } else {
          event.amountToPay = 0;
          event.amountToReceive = 0;
        }

        delete event.participant_names;
        delete event.participant_amounts;
        delete event.expense_amounts;
        delete event.paid_by_list;
        delete event.split_types;

        return event;
      });

      res.json(events);
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });


  // Get expense details
  router.get('/api/expenses/:expenseId', async (req, res) => {
    try {
      const { expenseId } = req.params;
      console.log('[Get Expense] Request received:', { expenseId });

      const query = `
       SELECT 
          e.*,
          GROUP_CONCAT(p.id ORDER BY p.id) AS participant_ids,
          GROUP_CONCAT(p.name ORDER BY p.id) AS participant_names,
          GROUP_CONCAT(ep.share_amount ORDER BY p.id) AS participant_shares,
          GROUP_CONCAT(ep.share_count ORDER BY p.id) AS participant_share_counts,
          GROUP_CONCAT(ep.he_participates ORDER BY p.id) AS participant_participates
        FROM expenses e
        LEFT JOIN expense_participants ep ON e.id = ep.expense_id
        LEFT JOIN participants p ON ep.participant_id = p.id
        WHERE e.id = ? 
        GROUP BY e.id;
      `;

      const results = await db.query(query, [expenseId]);
      
      if (!results || results.length === 0) {
        console.log('[Get Expense] Expense not found:', expenseId);
        return res.status(404).json({ error: 'Expense not found' });
      }

      const expenseData = results[0];
      
      // Process the concatenated data into a structured format
      const participantIds = expenseData.participant_ids ? expenseData.participant_ids.split(',') : [];
      const participantNames = expenseData.participant_names ? expenseData.participant_names.split(',') : [];
      const participantShares = expenseData.participant_shares ? expenseData.participant_shares.split(',') : [];
      const participantShareCounts = expenseData.participant_share_counts ? expenseData.participant_share_counts.split(',') : [];
      const participantParticipates = expenseData.participant_participates ? expenseData.participant_participates.split(',') : [];

      // Create participants array
      expenseData.participants = participantIds.map((id, index) => ({
        id,
        name: participantNames[index],
        share_amount: parseFloat(participantShares[index]) || 0,
        share_count: participantShareCounts[index] ? parseInt(participantShareCounts[index]) : null,
        he_participates: participantParticipates[index] === '1'
      }));

      // Remove concatenated fields
      delete expenseData.participant_ids;
      delete expenseData.participant_names;
      delete expenseData.participant_shares;
      delete expenseData.participant_share_counts;
      delete expenseData.participant_participates;

      // Log a summary instead of the full data
      console.log('[Get Expense] Successfully retrieved expense:', {
        expenseId,
        description: expenseData.description,
        amount: expenseData.amount,
        participantCount: expenseData.participants.length,
        split_type: expenseData.split_type,
        hasReceiptImage: !!expenseData.receipt_image
      });

      res.json(expenseData);
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Get expense details (alternative implementation)
  router.get('/api/expenses/:expenseId/details', async (req, res) => {
    try {
      const { expenseId } = req.params;
      
      // Utiliser la route principale pour assurer la cohérence
      // Rediriger vers la route principale
      console.log('[Get Expense Details] Redirecting to main expense endpoint');
      
      // Récupérer les détails de la dépense avec la requête complète
      const query = `
       SELECT 
    e.*,
    GROUP_CONCAT(p.id ORDER BY p.id) AS participant_ids,
    GROUP_CONCAT(p.name ORDER BY p.id) AS participant_names,
    GROUP_CONCAT(ep.share_amount ORDER BY p.id) AS participant_shares,
    GROUP_CONCAT(ep.share_count ORDER BY p.id) AS participant_share_counts, -- Added share_count
    GROUP_CONCAT(ep.he_participates ORDER BY p.id) AS participant_participates
FROM expenses e
LEFT JOIN expense_participants ep ON e.id = ep.expense_id
LEFT JOIN participants p ON ep.participant_id = p.id
WHERE e.id = ? 
GROUP BY e.id;
      `;

      // Utiliser l'API promise de mysql2 au lieu des callbacks
      const results = await db.query(query, [expenseId]);
      
      if (!results || results.length === 0) {
        console.log('[Get Expense Details] Expense not found:', expenseId);
        return res.status(404).json({ error: 'Expense not found' });
      }

      const expenseData = results[0];
      
      // Process the concatenated data into a structured format
      const participantIds = expenseData.participant_ids ? expenseData.participant_ids.split(',') : [];
      const participantNames = expenseData.participant_names ? expenseData.participant_names.split(',') : [];
      const participantShares = expenseData.participant_shares ? expenseData.participant_shares.split(',') : [];
      const participantParticipates = expenseData.participant_participates ? expenseData.participant_participates.split(',') : [];
      
      // Récupérer tous les participants de l'événement
      const eventId = expenseData.event_id;
      const allParticipantsQuery = 'SELECT id, name FROM participants WHERE event_id = ?';
      const allParticipants = await db.query(allParticipantsQuery, [eventId]);
      
      // Créer un mapping des participants existants dans la dépense
      const existingParticipantsMap = {};
      participantIds.forEach((id, index) => {
        existingParticipantsMap[id] = {
          participant_id: id,
          name: participantNames[index] || '',
          share_amount: parseFloat(participantShares[index] || 0),
          share_count: parseInt(participantShareCounts[index] || 1), // Added share_count, default to 1
          he_participates: participantParticipates[index] === '1'
        };
      });
      
      // Note: share_count est maintenant récupéré directement depuis la base de données
      // et n'est plus recalculé ici pour le type 'shares'.
      // La valeur de la base de données est utilisée telle quelle.
      
      // Construire la liste complète des participants
      expenseData.participants = allParticipants.map(p => {
        if (existingParticipantsMap[p.id]) {
          return existingParticipantsMap[p.id];
        } else {
          // Participant qui n'est pas dans la dépense
          return {
            participant_id: p.id,
            name: p.name,
            share_amount: 0,
            he_participates: false,
            share_count: 1 // Valeur par défaut pour les parts
          };
        }
      });

      // Remove temporary fields
      delete expenseData.participant_ids;
      delete expenseData.participant_names;
      delete expenseData.participant_shares;
      delete expenseData.participant_participates;

      console.log('[Get Expense Details] Successfully retrieved expense:', {
        expenseId,
        participantCount: expenseData.participants.length,
        split_type: expenseData.split_type
      });

      res.json(expenseData);
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Vérifier si un participant a des dépenses
  router.get('/api/events/:eventId/participants/:participantId/expenses', async (req, res) => {
    try {
      const { eventId, participantId } = req.params;

      const query = `
        SELECT COUNT(*) as expenseCount
        FROM expenses e
        LEFT JOIN expense_participants ep ON e.id = ep.expense_id
        LEFT JOIN participants p ON ep.participant_id = p.id
        WHERE e.event_id = ? AND p.id = ?
      `;

      // Utiliser l'API promise de mysql2 au lieu des callbacks
      const results = await db.query(query, [eventId, participantId]);
      
      if (!results || results.length === 0) {
        return res.status(500).json({ error: 'Database error' });
      }

      const hasExpenses = results[0].expenseCount > 0;
      res.json({ hasExpenses });
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Get event balances
  router.get('/api/events/:eventId/balances', async (req, res) => {
    try {
      const { eventId } = req.params;
      const userId = req.query.userId;

      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      // Utiliser le service de calcul des dettes
      const balances = await balanceService.calculateDebts(eventId, userId);
      
      res.json(balances);
    } catch (error) {
      console.error('Server error:', error);
      if (error.message === 'Event not found') {
        return res.status(404).json({ error: 'Event not found' });
      }
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Get user balances for an event
  router.get('/api/events/:eventId/user-balances', async (req, res) => {
    try {
      const { eventId } = req.params;
      const userId = req.query.userId;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Utiliser le service de calcul des dettes
      const balances = await balanceService.calculateDebts(eventId, userId);
      
      // Récupérer les dépenses payées par l'utilisateur
      const [participantRows] = await db.query(
        `SELECT p.id, p.name FROM participants p WHERE p.event_id = ? AND p.user_id = ?`,
        [eventId, userId]
      );
      
      if (participantRows.length === 0) {
        return res.json({
          ...balances,
          paidExpenses: [],
          transactions: balances.debts
        });
      }
      
      const userParticipant = participantRows[0];
      
      // Récupérer les dépenses payées par l'utilisateur
      const [expenseRows] = await db.query(
        `SELECT e.id, e.description, e.amount, e.created_date 
         FROM expenses e 
         WHERE e.event_id = ? AND e.paid_by = ?`,
        [eventId, userParticipant.name]
      );
      
      const paidExpenses = expenseRows.map(expense => ({
        id: expense.id,
        amount: parseFloat(expense.amount),
        description: expense.description,
        created_date: expense.created_date
      }));
      
      // Transformer les dettes en transactions pour l'utilisateur
      const transactions = balances.debts.filter(debt => 
        debt.from === userParticipant.name || debt.to === userParticipant.name
      ).map(debt => {
        if (debt.from === userParticipant.name) {
          return {
            ...debt,
            type: 'to_pay',
            label: `Vous devez ${debt.amount} à ${debt.to}`
          };
        } else {
          return {
            ...debt,
            type: 'to_receive',
            label: `${debt.from} vous doit ${debt.amount}`
          };
        }
      });
      
      res.json({
        ...balances,
        paidExpenses,
        transactions
      });
    } catch (error) {
      console.error('Server error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

 // Update event
 router.put('/api/events/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { name, startDate, endDate, currency, participants, userId } = req.body;

    // Validate input
if (!name || !startDate || !endDate || !currency || !participants || !Array.isArray(participants)) {
  return res.status(400).json({ error: 'Invalid input data' });
}

// Get current event data
const getEventQuery = 'SELECT * FROM events WHERE id = ?';
const eventResults = await db.query(getEventQuery, [eventId]);
if (!eventResults || eventResults.length === 0) {
  return res.status(404).json({ error: 'Event not found' });
}

// Get current participants
const getParticipantsQuery = 'SELECT * FROM participants WHERE event_id = ?';
const currentParticipants = await db.query(getParticipantsQuery, [eventId]);

// Update event details
const updateEventQuery = `
  UPDATE events 
  SET name = ?, start_date = ?, end_date = ?, currency = ?, split_type = ?
  WHERE id = ?
`;
const splitTypeValue = req.body.split_type || req.body.splitType || 'equal';
await db.query(
  updateEventQuery,
  [name, startDate, endDate, currency, splitTypeValue, eventId]
);

// Get all expenses for this event to manage participants
const getExpensesQuery = 'SELECT id FROM expenses WHERE event_id = ?';
const expenses = await db.query(getExpensesQuery, [eventId]);

// Handle participants
const participantPromises = [];

// 1. Identify new participants (those not in the current list)
const newParticipants = participants.filter(
  p => !currentParticipants.some(cp => cp.name === p.name)
);
console.log('Current participants:', currentParticipants);
  console.log('New participants:', newParticipants); // Ajout d'un log pour déboguer les nouvelles participations
// 2. Add new participants
for (const participant of newParticipants) {
  /*participantPromises.push(
    db.query(
      'INSERT INTO participants (event_id, name, user_id, custom_amount) VALUES (?, ?, ?, ?)',
      [eventId, participant.name, participant.user_id || null, participant.custom_amount || null]
    )


  );*/


  console.log('[Update Event] Inserting new participant:', {eventId, participantName: participant.name});
  const insertResult = await db.query(
    'INSERT INTO participants (event_id, name, user_id, custom_amount) VALUES (?, ?, ?, ?)',
    [eventId, participant.name, participant.user_id || null, participant.custom_amount || null]
  );
  const participantId = insertResult.insertId;
  console.log('[Update Event] Participant inserted with ID:', participantId);





  // Add new participants to expenses with he_participates = 0 and share_amount = 0
 for (const expense of expenses) {
    await db.query(
      'INSERT INTO expense_participants (expense_id, participant_id, he_participates, share_amount) VALUES (?, ?, 0, 0)',
      [expense.id, participantId]
    );
    console.log('Added new participant to expenses:', {participantId, expenseId: expense.id});
  }
}

// 3. Update existing participants
for (const participant of participants) {
  const existingParticipant = currentParticipants.find(cp => cp.id === participant.id);
  if (existingParticipant) {
    participantPromises.push(
      db.query(
        'UPDATE participants SET name = ?, custom_amount = ? WHERE id = ?',
        [participant.name, participant.custom_amount || null, participant.id]
      )
    );
  }
}

// 4. Execute all participant updates
await Promise.all(participantPromises);

// 5. Return success response
res.json({
  success: true,
  message: 'Event updated successfully',
  eventId,
  updatedFields: { name, startDate, endDate, currency, splitTypeValue, participants }
});
  } catch (error) {
    console.error('[Update Event] Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete event endpoint
router.delete('/api/events/:id', async (req, res) => {
  try {
    const eventId = req.params.id;
    
    console.log('[Delete Event] Request received:', { eventId });

    // Check if event exists
    const [eventRows] = await db.query('SELECT id FROM events WHERE id = ?', [eventId]);
    if (!eventRows || eventRows.length === 0) {
      console.log('[Delete Event] Event not found:', eventId);
      return res.status(404).json({ error: 'Event not found' });
    }

    // Delete event (cascade will handle participants and expenses)
    await db.query('DELETE FROM events WHERE id = ?', [eventId]);

    console.log('[Delete Event] Successfully deleted event:', { eventId });
    res.json({ success: true });
  } catch (error) {
    console.error('[Delete Event] Error:', {
      message: error.message,
      stack: error.stack,
      eventId: req.params.id
    });
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// Get debts for user
router.get('/api/debts/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get all events where the user is a participant
    const eventsQuery = `
      SELECT DISTINCT e.id, e.name as event_name, e.currency
      FROM events e
      JOIN participants p ON e.id = p.event_id
      WHERE p.user_id = ?
    `;
    const events = await db.query(eventsQuery, [userId]);
    
    const debts = [];
    
    // For each event, calculate the debts
    for (const event of events) {
      const balances = await balanceService.calculateDebts(event.id, userId);
      
      // Get the user's participant name
      const userParticipantQuery = `
        SELECT name FROM participants 
        WHERE event_id = ? AND user_id = ?
      `;
      const userParticipantResult = await db.query(userParticipantQuery, [event.id, userId]);
      
      if (userParticipantResult && userParticipantResult.length > 0) {
        const userName = userParticipantResult[0].name;
        
        // Find debts where the user is the debtor (from)
        // Inclure toutes les dettes, même celles avec un montant de 0 (complètement remboursées)
        const userDebts = balances.debts.filter(debt => 
          debt.from === userName
        );
        
        // Add event information to each debt
        const debtsWithEvent = userDebts.map(debt => ({
          id: event.id, // Using event id as debt id for now
          amount: debt.amount,
          creditor: {
            name: debt.to
          },
          event: {
            id: event.id,
            name: event.event_name,
            currency: event.currency
          }
        }));
        
        debts.push(...debtsWithEvent);
      }
    }
    
    res.json({ debts });
  } catch (error) {
    console.error('Error fetching debts:', error);
    res.status(500).json({ error: 'Failed to fetch debts' });
  }
});

// Create a new reimbursement
router.post('/api/reimbursements', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const { event_id, from, to, amount, currency } = req.body;

    // Vérifier que tous les paramètres requis sont présents
    if (!event_id || !from || !to || !amount || !currency) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Récupérer les IDs des participants
    const debtorResult = await db.query(
      'SELECT id FROM participants WHERE event_id = ? AND name = ?',
      [event_id, from]
    );
    const creditorResult = await db.query(
      'SELECT id FROM participants WHERE event_id = ? AND name = ?',
      [event_id, to]
    );
    
    // Check if results exist and have at least one row
    if (!debtorResult || debtorResult.length === 0 || !creditorResult || creditorResult.length === 0) {
      return res.status(400).json({ error: 'Participants not found' });
    }
    
    const debtor = debtorResult[0];
    const creditor = creditorResult[0];

    // Vérifier que le débiteur est bien l'utilisateur connecté
    /* (debtor.id !== parseInt(userId)) {
      return res.status(403).json({ error: 'You can only create reimbursements for yourself' });
    }*/

    // Insérer le remboursement avec le statut 'completed'
    const result = await db.query(
      'INSERT INTO reimbursements (event_id, debtor_id, creditor_id, amount, date, status, currency) VALUES (?, ?, ?, ?, NOW(), ?, ?)',
      [event_id, debtor.id, creditor.id, amount, 'pending', currency]
    );

    res.status(201).json({ id: result.insertId });
  } catch (error) {
    console.error('Error creating reimbursement:', error);
    res.status(500).json({ error: 'Failed to create reimbursement' });
  }
});

// Update reimbursement status
router.patch('/api/reimbursements/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Get the reimbursement details
    const reimbursementQuery = `
      SELECT r.*, p.user_id as creditor_user_id 
      FROM reimbursements r
      JOIN participants p ON r.creditor_id = p.id
      WHERE r.id = ?
    `;
    const reimbursementResult = await db.query(reimbursementQuery, [id]);
    
    if (!reimbursementResult || reimbursementResult.length === 0) {
      return res.status(404).json({ error: 'Reimbursement not found' });
    }
    
    const reimbursement = reimbursementResult[0];
    
    // Verify the user is either the debtor or creditor
    const isCreditor = reimbursement.creditor_user_id === req.user.id;
    const isDebtor = reimbursement.debtor_id === req.user.id;
    
    if (!isCreditor && !isDebtor) {
      return res.status(403).json({ error: 'Unauthorized: Only the debtor or creditor can update the status' });
    }
    
    // Only allow status updates based on user role
    if (isDebtor && status !== 'completed') {
      return res.status(403).json({ error: 'Debtor can only mark as completed' });
    }
    
    if (isCreditor && !['completed', 'disputed'].includes(status)) {
      return res.status(403).json({ error: 'Creditor can only mark as completed or disputed' });
    }
    
    const updateQuery = 'UPDATE reimbursements SET status = ? WHERE id = ?';
    await db.query(updateQuery, [status, id]);
    
    res.json({ message: 'Reimbursement status updated successfully' });
  } catch (error) {
    console.error('Error updating reimbursement status:', error);
    res.status(500).json({ error: 'Failed to update reimbursement status' });
  }
});

// Get reimbursement history for a user
router.get('/api/reimbursements/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const query = `
      SELECT r.*, 
             e.name as event_name,
             pd.name as debtor_name,
             pc.name as creditor_name
      FROM reimbursements r
      JOIN participants pd ON r.debtor_id = pd.id
      JOIN participants pc ON r.creditor_id = pc.id
      JOIN events e ON pd.event_id = e.id
      WHERE pd.user_id = ? OR pc.user_id = ?
      ORDER BY r.created_at DESC
    `;
    
    const reimbursements = await db.query(query, [userId, userId]);
    
    res.json({ reimbursements });
  } catch (error) {
    console.error('Error fetching reimbursement history:', error);
    res.status(500).json({ error: 'Failed to fetch reimbursement history' });
  }
});

// POST: Register a new device token
router.post('/api/device-tokens', async (req, res) => {
  console.log('🔔 [SERVER] ====== DEVICE TOKEN REGISTRATION START ======');
  console.log('🔔 [SERVER] Request headers:', req.headers);
  console.log('🔔 [SERVER] Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { userId, token, deviceType } = req.body;
    
    // Log each field separately
    console.log('🔔 [SERVER] Parsed fields:', {
      userId: userId ? `exists (${userId})` : 'missing',
      token: token ? `exists (${token.substring(0, 10)}...)` : 'missing',
      deviceType: deviceType ? `exists (${deviceType})` : 'missing'
    });
    
    if (!userId || !token || !deviceType) {
      console.warn('⚠️ [SERVER] Missing required fields:', { 
        hasUserId: !!userId, 
        hasToken: !!token, 
        hasDeviceType: !!deviceType 
      });
      return res.status(400).json({ error: 'User ID, token, and device type are required' });
    }

    // Check if the user exists
    console.log('🔔 [SERVER] Checking if user exists:', userId);
    const userCheck = await db.query('SELECT id, username FROM users WHERE id = ?', [userId]);
    if (!userCheck || userCheck.length === 0) {
      console.warn('⚠️ [SERVER] User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }
    console.log('✅ [SERVER] User found:', { id: userCheck[0].id, username: userCheck[0].username });

    // Check if token already exists
    console.log('🔔 [SERVER] Checking if token already exists');
    const existingToken = await db.query('SELECT id, user_id, device_type FROM device_tokens WHERE token = ?', [token]);
    if (existingToken && existingToken.length > 0) {
      console.log('🔔 [SERVER] Token exists:', {
        tokenId: existingToken[0].id,
        currentUserId: existingToken[0].user_id,
        currentDeviceType: existingToken[0].device_type,
        newUserId: userId,
        newDeviceType: deviceType
      });
      
      // Update the existing token
      const updateResult = await db.query(
        'UPDATE device_tokens SET user_id = ?, device_type = ?, updated_at = NOW() WHERE token = ?',
        [userId, deviceType, token]
      );
      console.log('✅ [SERVER] Token update result:', {
        affectedRows: updateResult.affectedRows,
        changedRows: updateResult.changedRows
      });
    } else {
      console.log('🔔 [SERVER] Token is new, inserting for user:', userId);
      // Insert new token
      const insertResult = await db.query(
        'INSERT INTO device_tokens (user_id, token, device_type) VALUES (?, ?, ?)',
        [userId, token, deviceType]
      );
      console.log('✅ [SERVER] New token insert result:', {
        insertId: insertResult.insertId,
        affectedRows: insertResult.affectedRows
      });
    }

    // Verify the token was saved
    const verifyToken = await db.query(
      'SELECT id, user_id, device_type, created_at, updated_at FROM device_tokens WHERE token = ? AND user_id = ?',
      [token, userId]
    );
    console.log('🔔 [SERVER] Verification query result:', verifyToken.length > 0 ? {
      found: true,
      tokenId: verifyToken[0].id,
      userId: verifyToken[0].user_id,
      deviceType: verifyToken[0].device_type,
      createdAt: verifyToken[0].created_at,
      updatedAt: verifyToken[0].updated_at
    } : 'Token not found');

    console.log('🔔 [SERVER] ====== DEVICE TOKEN REGISTRATION END ======');

    res.json({ 
      success: true, 
      message: 'Device token registered successfully',
      tokenSaved: verifyToken.length > 0,
      tokenDetails: verifyToken.length > 0 ? {
        id: verifyToken[0].id,
        userId: verifyToken[0].user_id,
        deviceType: verifyToken[0].device_type,
        createdAt: verifyToken[0].created_at,
        updatedAt: verifyToken[0].updated_at
      } : null
    });
  } catch (error) {
    console.error('❌ [SERVER] Error registering device token:', error);
    console.error('❌ [SERVER] Error details:', {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      sqlState: error.sqlState
    });
    res.status(500).json({ 
      error: 'Server error while registering device token',
      details: error.message
    });
  }
});

// GET: Get device token for a user
router.get('/api/device-tokens/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const tokens = await db.query(
      'SELECT token FROM device_tokens WHERE user_id = ?',
      [userId]
    );

    if (!tokens || tokens.length === 0) {
      return res.status(404).json({ error: 'No device tokens found for user' });
    }

    // Return the most recent token
    res.json({ token: tokens[0].token });
  } catch (error) {
    console.error('Error fetching device token:', error);
    res.status(500).json({ error: 'Server error while fetching device token' });
  }
});

// POST: Send push notification
router.post('/api/send-push-notification', async (req, res) => {
  try {
    const { to, title, body, data, sound, priority } = req.body;

    if (!to || !title || !body) {
      return res.status(400).json({ error: 'Recipient token, title, and body are required' });
    }

    // Validate the token
    if (!Expo.isExpoPushToken(to)) {
      return res.status(400).json({ error: 'Invalid Expo push token' });
    }

    // Create the message
    const message = {
      to,
      sound: sound || 'default',
      title,
      body,
      data: data || {},
      priority: priority || 'default',
    };

    // Send the message
    const chunks = expo.chunkPushNotifications([message]);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending push notification chunk:', error);
      }
    }

    // Check for errors
    const errors = tickets.filter(ticket => ticket.status === 'error');
    if (errors.length > 0) {
      console.error('Push notification errors:', errors);
      return res.status(500).json({ 
        error: 'Some notifications failed to send',
        details: errors
      });
    }

    res.json({ 
      success: true, 
      message: 'Push notification sent successfully',
      tickets
    });
  } catch (error) {
    console.error('Error sending push notification:', error);
    res.status(500).json({ error: 'Server error while sending push notification' });
  }
});

// NOTIFICATIONS API ENDPOINTS

// POST: Create a new notification
router.post('/api/notifications', async (req, res) => {
  try {
    const { 
      userId, 
      title, 
      message, 
      type, 
      actionUserId, 
      actionUserName, 
      amount, 
      currency, 
      eventId, 
      eventName, 
      debtId, 
      referenceData 
    } = req.body;

    if (!userId || !title || !message || !type) {
      return res.status(400).json({ error: 'User ID, title, message, and type are required' });
    }

    // Convert undefined values to null for all optional parameters
    const insertQuery = `
      INSERT INTO notifications (
        user_id, title, message, type, action_user_id, action_user_name,
        amount, currency, event_id, event_name, debt_id, reference_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      parseInt(userId),
      title,
      message,
      type,
      actionUserId ? parseInt(actionUserId) : null,
      actionUserName || null,
      amount ? parseFloat(amount) : null,
      currency || null,
      eventId ? parseInt(eventId) : null,
      eventName || null,
      debtId || null,
      referenceData ? JSON.stringify(referenceData) : null
    ];

    // Validate that no undefined values are being passed
    if (params.some(param => param === undefined)) {
      console.error('Invalid parameters:', { params, body: req.body });
      return res.status(400).json({ error: 'Invalid parameters provided' });
    }

    const result = await db.query(insertQuery, params);

    res.status(201).json({ 
      success: true, 
      message: 'Notification created successfully',
      notificationId: result.insertId
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ error: 'Server error while creating notification' });
  }
});

// GET: Get all notifications for a user
router.get('/api/notifications/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = '50', offset = '0', unreadOnly = false } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Ensure limit and offset are valid numbers and convert to integers
    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit) || 50));
    const parsedOffset = Math.max(0, parseInt(offset) || 0);

    // Build the query with LIMIT and OFFSET as part of the query string
    let query = `
      SELECT 
        id, title, message, type, action_user_id, action_user_name,
        amount, currency, event_id, event_name, debt_id, reference_data,
        is_read, created_at, updated_at
      FROM notifications 
      WHERE user_id = ?
    `;
    
    const params = [parseInt(userId)];

    if (unreadOnly === 'true') {
      query += ' AND is_read = FALSE';
    }

    // Get total count first
    const countQuery = query.replace('SELECT \n        id, title, message, type, action_user_id, action_user_name,\n        amount, currency, event_id, event_name, debt_id, reference_data,\n        is_read, created_at, updated_at', 'SELECT COUNT(*) as total');
    const countResult = await db.query(countQuery, params);
    const total = countResult?.[0]?.[0]?.total || 0;

    // Add ORDER BY and LIMIT/OFFSET directly in the query string
    query += ` ORDER BY created_at DESC LIMIT ${parsedLimit} OFFSET ${parsedOffset}`;
    
    // Execute the paginated query
    const notifications = await db.query(query, params);

    // Parse JSON reference_data for each notification
    const formattedNotifications = notifications.map(notification => ({
      ...notification,
      reference_data: notification.reference_data ? 
        (typeof notification.reference_data === 'string' ? 
          JSON.parse(notification.reference_data) : 
          notification.reference_data) : 
        null
    }));

    // Get unread count
    const unreadCountQuery = 'SELECT COUNT(*) as unreadCount FROM notifications WHERE user_id = ? AND is_read = FALSE';
    const unreadCountResult = await db.query(unreadCountQuery, [parseInt(userId)]);
    const unreadCount = unreadCountResult?.[0]?.[0]?.unreadCount || 0;

    res.json({ 
      notifications: formattedNotifications,
      unreadCount: unreadCount,
      total: total
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Server error while fetching notifications' });
  }
});

// GET: Get unread notification count for a user
router.get('/api/notifications/:userId/count', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const query = 'SELECT COUNT(*) as unreadCount FROM notifications WHERE user_id = ? AND is_read = FALSE';
    const result = await db.query(query, [userId]);
    const unreadCount = result[0]?.unreadCount || 0;

    res.json({ unreadCount });
  } catch (error) {
    console.error('Error fetching notification count:', error);
    res.status(500).json({ error: 'Server error while fetching notification count' });
  }
});

// PUT: Mark notification as read/unread
router.put('/api/notifications/:notificationId/read', async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { isRead = true } = req.body;

    if (!notificationId) {
      return res.status(400).json({ error: 'Notification ID is required' });
    }

    const updateQuery = 'UPDATE notifications SET is_read = ? WHERE id = ?';
    const result = await db.query(updateQuery, [isRead, notificationId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ 
      success: true, 
      message: `Notification marked as ${isRead ? 'read' : 'unread'}` 
    });
  } catch (error) {
    console.error('Error updating notification read status:', error);
    res.status(500).json({ error: 'Server error while updating notification' });
  }
});

// PUT: Mark all notifications as read for a user
router.put('/api/notifications/:userId/mark-all-read', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const updateQuery = 'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE';
    const result = await db.query(updateQuery, [userId]);

    res.json({ 
      success: true, 
      message: 'All notifications marked as read',
      updatedCount: result.affectedRows
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Server error while updating notifications' });
  }
});

// DELETE: Delete a notification
router.delete('/api/notifications/:notificationId', async (req, res) => {
  try {
    const { notificationId } = req.params;

    if (!notificationId) {
      return res.status(400).json({ error: 'Notification ID is required' });
    }

    const deleteQuery = 'DELETE FROM notifications WHERE id = ?';
    const result = await db.query(deleteQuery, [notificationId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ 
      success: true, 
      message: 'Notification deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Server error while deleting notification' });
  }
});

  // Test endpoint to verify expense updates when participant joins
  router.get('/api/test-expense-updates/:eventId', async (req, res) => {
    try {
      const { eventId } = req.params;
      
      // Get all participants in the event
      const participants = await db.query('SELECT id, name, user_id FROM participants WHERE event_id = ?', [eventId]);
      
      // Get all expenses in the event with their paid_by values
      const expenses = await db.query('SELECT id, description, paid_by, amount FROM expenses WHERE event_id = ?', [eventId]);
      
      // Check for mismatches between participant names and expense paid_by values
      const participantNames = participants.map(p => p.name);
      const expensePaidByValues = [...new Set(expenses.map(e => e.paid_by))];
      
      const orphanedPaidByValues = expensePaidByValues.filter(paidBy => 
        !participantNames.includes(paidBy)
      );
      
      res.json({
        eventId,
        participants: participants.map(p => ({
          id: p.id,
          name: p.name,
          hasUser: !!p.user_id,
          userId: p.user_id
        })),
        expenses: expenses.map(e => ({
          id: e.id,
          description: e.description,
          paid_by: e.paid_by,
          amount: e.amount,
          paidByExists: participantNames.includes(e.paid_by)
        })),
        summary: {
          totalParticipants: participants.length,
          participantsWithUsers: participants.filter(p => p.user_id).length,
          totalExpenses: expenses.length,
          orphanedPaidByValues,
          hasOrphanedExpenses: orphanedPaidByValues.length > 0
        }
      });
    } catch (error) {
      console.error('Error in test endpoint:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
};

// Export both the router creator and the logger
module.exports = {
  createRouter,
  serverNotificationLogger: serverLogger
};
