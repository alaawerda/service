const db = require('../db');
const Joi = require('joi');

class BalanceService {
  /**
   * Calcule les dettes entre participants d'un événement
   * @param {number} eventId - ID de l'événement
   * @param {number} connectedUserId - ID de l'utilisateur connecté
   * @returns {Object} Objet contenant les dettes et le résumé pour l'utilisateur connecté
   */
  async calculateDebts(eventId, connectedUserId) {
    try {
      const { error } = Joi.number().integer().required().validate(eventId);
      if (error) {
        throw new Error('Invalid event ID');
      }
      console.log(`Calculating debts for event ${eventId} and user ${connectedUserId}`);
      
      // 1. Récupérer toutes les dépenses de l'événement avec leurs participants
      const expenses = await this.getEventExpenses(eventId);
      console.log(`Found ${expenses.length} expenses for event ${eventId}`);
      
      // 2. Récupérer tous les participants de l'événement
      const participants = await this.getEventParticipants(eventId);
      console.log(`Found ${participants.length} participants for event ${eventId}`);
      
      // 3. Calculer les dettes optimisées entre participants
      const debts = this.computeDebts(expenses, participants);
      console.log(`Computed ${debts.length} optimized debts:`, JSON.stringify(debts));
      
      // 4. Récupérer tous les remboursements de l'événement avec leur statut
      const reimbursements = await db.query(`
        SELECT 
          r.id, r.amount, r.date, r.created_at, r.debtor_id, r.creditor_id, r.event_id, r.status,
          pd.name as debtor_name,
          pc.name as creditor_name
        FROM reimbursements r
        JOIN participants pd ON r.debtor_id = pd.id
        JOIN participants pc ON r.creditor_id = pc.id
        WHERE r.event_id = ?
        ORDER BY r.date ASC, r.created_at ASC
      `, [eventId]);

      console.log('Tous les remboursements trouvés:', JSON.stringify(reimbursements, null, 2));
      console.log(`Nombre total de remboursements: ${reimbursements.length}`);

      // 5. Appliquer les remboursements aux dettes optimisées
      const finalDebts = this.applyReimbursements(debts, reimbursements, participants, expenses);

      // 6. Calculer les totaux pour l'utilisateur connecté
      const userParticipant = participants.find(p => p.user_id === parseInt(connectedUserId));
      
      if (!userParticipant) {
        return {
          debts: [],
          total_to_pay: 0,
          total_to_receive: 0,
          pending_to_pay: 0
        };
      }

      const userSummary = this.calculateUserSummary(finalDebts, userParticipant.name);

      console.log('Vérification des totaux finaux:');
      console.log('Total à payer:', userSummary.total_to_pay);
      console.log('Total à recevoir:', userSummary.total_to_receive);
      console.log('En attente de remboursement:', userSummary.pending_to_pay);
      console.log('Dettes finales:', finalDebts.length);

      return {
        debts: finalDebts,
        total_to_pay: userSummary.total_to_pay,
        total_to_receive: userSummary.total_to_receive,
        pending_to_pay: userSummary.pending_to_pay,
        rejected_to_pay: userSummary.rejected_to_pay || 0
      };
    } catch (error) {
      console.error('Error calculating debts:', error);
      throw error;
    }
  }

  /**
   * Calcule les dettes entre participants avec optimisation par paires
   * @param {Array} expenses - Liste des dépenses
   * @param {Array} participants - Liste des participants
   * @returns {Array} Liste des dettes optimisées entre participants
   */
  computeDebts(expenses, participants) {
    console.log('Computing debts using pairwise optimization method...');
    
    // 1. Calculer les dettes directes entre chaque paire de participants
    const pairwiseDebts = this.calculatePairwiseDebts(expenses, participants);
    console.log('Dettes par paire calculées:', pairwiseDebts);
    
    // 2. Optimiser les dettes entre chaque paire (éliminer A→B et B→A)
    const optimizedPairwiseDebts = this.optimizePairwiseDebts(pairwiseDebts);
    console.log('Dettes par paire optimisées:', optimizedPairwiseDebts);
    
    // 3. Vérifier l'équilibre global
    this.verifyGlobalBalance(optimizedPairwiseDebts, participants);
    
    return optimizedPairwiseDebts;
  }

  /**
   * Calcule les dettes directes entre chaque paire de participants
   * @param {Array} expenses - Liste des dépenses
   * @param {Array} participants - Liste des participants
   * @returns {Map} Map des dettes par paire (clé: "from-to", valeur: montant)
   */
  calculatePairwiseDebts(expenses, participants) {
    // Initialiser une matrice de dettes pour chaque paire
    const debtMatrix = new Map();
    
    // Initialiser toutes les paires à 0
    participants.forEach(p1 => {
      participants.forEach(p2 => {
        if (p1.name !== p2.name) {
          const key = `${p1.name}-${p2.name}`;
          debtMatrix.set(key, 0);
        }
      });
    });
    
    // Pour chaque dépense, calculer qui doit combien à qui
    expenses.forEach(expense => {
      const payer = expense.paid_by;
      
      console.log(`\nAnalyse de la dépense: ${expense.description} (${expense.amount}€) payée par ${payer}`);
      
      // Pour chaque participant à cette dépense
      expense.participants.forEach(participant => {
        if (participant.name !== payer) {
          const shareAmount = parseFloat(participant.share_amount);
          if (!isNaN(shareAmount) && shareAmount > 0) {
            const key = `${participant.name}-${payer}`;
            const currentDebt = debtMatrix.get(key) || 0;
            debtMatrix.set(key, currentDebt + shareAmount);
            
            console.log(`  ${participant.name} doit ${shareAmount}€ à ${payer} (total: ${(currentDebt + shareAmount).toFixed(2)}€)`);
          }
        }
      });
    });
    
    return debtMatrix;
  }

  /**
   * Optimise les dettes entre chaque paire (élimine les cycles A→B et B→A)
   * @param {Map} pairwiseDebts - Map des dettes par paire
   * @returns {Array} Liste des dettes optimisées
   */
  optimizePairwiseDebts(pairwiseDebts) {
    console.log('\nOptimisation des dettes par paire...');
    
    const optimizedDebts = [];
    const processedPairs = new Set();
    
    // Récupérer tous les noms de participants uniques
    const participantNames = new Set();
    for (const key of pairwiseDebts.keys()) {
      const [from, to] = key.split('-');
      participantNames.add(from);
      participantNames.add(to);
    }
    
    // Pour chaque paire de participants, optimiser les dettes dans les deux sens
    Array.from(participantNames).forEach(p1 => {
      Array.from(participantNames).forEach(p2 => {
        if (p1 !== p2) {
          const pairKey = [p1, p2].sort().join('-');
          
          // Éviter de traiter la même paire deux fois
          if (processedPairs.has(pairKey)) return;
          processedPairs.add(pairKey);
          
          // Récupérer les dettes dans les deux sens
          const debt1to2 = pairwiseDebts.get(`${p1}-${p2}`) || 0;
          const debt2to1 = pairwiseDebts.get(`${p2}-${p1}`) || 0;
          
          console.log(`\nAnalyse paire ${p1} ↔ ${p2}:`);
          console.log(`  ${p1} → ${p2}: ${debt1to2.toFixed(2)}€`);
          console.log(`  ${p2} → ${p1}: ${debt2to1.toFixed(2)}€`);
          
          // Calculer la dette nette
          const netAmount = Math.abs(debt1to2 - debt2to1);
          
          if (netAmount > 0.01) { // Seuil pour éviter les arrondis
            let from, to;
            if (debt1to2 > debt2to1) {
              from = p1;
              to = p2;
            } else {
              from = p2;
              to = p1;
            }
            
            optimizedDebts.push({
              from: from,
              to: to,
              amount: parseFloat(netAmount.toFixed(2))
            });
            
            console.log(`  → Dette nette: ${from} doit ${netAmount.toFixed(2)}€ à ${to}`);
          } else {
            console.log(`  → Équilibré (différence: ${netAmount.toFixed(2)}€)`);
          }
        }
      });
    });
    
    console.log(`\nRésultat: ${optimizedDebts.length} dette(s) optimisée(s) entre paires`);
    return optimizedDebts;
  }

  /**
   * Vérifie l'équilibre global des dettes
   * @param {Array} debts - Liste des dettes
   * @param {Array} participants - Liste des participants
   */
  verifyGlobalBalance(debts, participants) {
    console.log('\nVérification de l\'équilibre global...');
    
    const balances = {};
    participants.forEach(p => {
      balances[p.name] = 0;
    });
    
    // Calculer les balances à partir des dettes optimisées
    debts.forEach(debt => {
      balances[debt.from] -= debt.amount; // Le débiteur a une balance négative
      balances[debt.to] += debt.amount;   // Le créancier a une balance positive
    });
    
    // Vérifier que la somme totale est équilibrée
    const totalBalance = Object.values(balances).reduce((sum, balance) => sum + balance, 0);
    
    console.log('Balances finales par participant:');
    Object.entries(balances).forEach(([name, balance]) => {
      const rounded = parseFloat(balance.toFixed(2));
      if (rounded > 0.01) {
        console.log(`  ${name}: +${rounded}€ (à recevoir)`);
      } else if (rounded < -0.01) {
        console.log(`  ${name}: ${rounded}€ (à payer)`);
      } else {
        console.log(`  ${name}: équilibré`);
      }
    });
    
    console.log(`Balance totale: ${totalBalance.toFixed(2)}€`);
    
    if (Math.abs(totalBalance) > 0.02) {
      console.warn('ATTENTION: Déséquilibre global détecté!');
    } else {
      console.log('✓ Équilibre global vérifié');
    }
  }

  /**
   * Applique les remboursements aux dettes optimisées
   * @param {Array} debts - Liste des dettes optimisées
   * @param {Array} reimbursements - Liste des remboursements
   * @param {Array} participants - Liste des participants
   * @param {Array} expenses - Liste des dépenses
   * @returns {Array} Liste des dettes avec remboursements appliqués
   */
  applyReimbursements(debts, reimbursements, participants, expenses) {
    console.log('Applying reimbursements to optimized debts...');
    
    const finalDebts = [];
    
    debts.forEach(debt => {
      // Récupérer tous les remboursements pour cette paire
      const allReimbursements = reimbursements.filter(r => 
        r.debtor_name === debt.from && 
        r.creditor_name === debt.to
      ).sort((a, b) => {
        const dateA = new Date(a.date || a.created_at);
        const dateB = new Date(b.date || b.created_at);
        return dateA - dateB;
      });

      // Calculer les montants des remboursements par statut
      const completedReimbursement = allReimbursements
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + parseFloat(r.amount), 0);
      
      const pendingReimbursement = allReimbursements
        .filter(r => r.status === 'pending')
        .reduce((sum, r) => sum + parseFloat(r.amount), 0);
      
      const rejectedReimbursement = allReimbursements
        .filter(r => r.status === 'rejected')
        .reduce((sum, r) => sum + parseFloat(r.amount), 0);

      // Construire le tableau des statuts de remboursement
      const reimbursementStatuses = allReimbursements.map(r => ({
        id: r.id,
        amount: parseFloat(r.amount),
        status: r.status,
        date: r.date || r.created_at
      }));

      // Calculer le montant restant après les remboursements complétés
      const remainingAmount = parseFloat((debt.amount - completedReimbursement).toFixed(2));
      const totalReimbursed = completedReimbursement + pendingReimbursement;
      
      // Vérifier si la dette est complètement remboursée
      const isFullyReimbursed = remainingAmount <= 0.01 && completedReimbursement >= debt.amount;

      // Récupérer les IDs des participants
      const debtorParticipant = participants.find(p => p.name === debt.from);
      const creditorParticipant = participants.find(p => p.name === debt.to);

      const finalDebt = {
        from: debt.from,
        to: debt.to,
        amount: Math.max(0, remainingAmount),
        originalAmount: debt.amount,
        reimbursedAmount: completedReimbursement,
        pendingReimbursement: pendingReimbursement,
        rejectedReimbursement: rejectedReimbursement,
        totalReimbursed: totalReimbursed,
        isFullyReimbursed: isFullyReimbursed,
        currency: expenses[0]?.currency || 'EUR',
        debtor_id: debtorParticipant?.user_id,
        creditor_id: creditorParticipant?.user_id,
        reimbursementStatuses: reimbursementStatuses,
        debtEntries: [] // Pour compatibilité
      };

      finalDebts.push(finalDebt);
      
      console.log(`Dette ${debt.from} → ${debt.to}: ${debt.amount}€ → ${finalDebt.amount}€ après remboursements`);
    });

    return finalDebts;
  }

  /**
   * Calcule le résumé pour l'utilisateur connecté
   * @param {Array} debts - Liste des dettes
   * @param {string} userName - Nom de l'utilisateur
   * @returns {Object} Résumé pour l'utilisateur connecté
   */
  calculateUserSummary(debts, userName) {
    let total_to_pay = 0;
    let total_to_receive = 0;
    let pending_to_pay = 0;
    let rejected_to_pay = 0;
    
    debts.forEach(debt => {
      if (debt.from === userName) {
        // L'utilisateur doit payer
        total_to_pay += debt.amount;
        pending_to_pay += debt.pendingReimbursement || 0;
        rejected_to_pay += debt.rejectedReimbursement || 0;
      }
      
      if (debt.to === userName) {
        // L'utilisateur doit recevoir
        total_to_receive += debt.amount;
      }
    });
    
    return {
      total_to_pay: parseFloat(total_to_pay.toFixed(2)),
      total_to_receive: parseFloat(total_to_receive.toFixed(2)),
      pending_to_pay: parseFloat(pending_to_pay.toFixed(2)),
      rejected_to_pay: parseFloat(rejected_to_pay.toFixed(2))
    };
  }

  /**
   * Récupère toutes les dépenses d'un événement avec leurs participants
   * @param {number} eventId - ID de l'événement
   * @returns {Array} Liste des dépenses avec leurs participants
   */
  async getEventExpenses(eventId) {
    try {
      // Récupérer les dépenses
      const expensesQuery = `
        SELECT e.id, e.description, e.amount, e.paid_by, e.split_type, e.currency, e.created_at
        FROM expenses e
        WHERE e.event_id = ?
      `;
      const expenses = await db.query(expensesQuery, [eventId]);
      
      // Pour chaque dépense, récupérer les participants
      for (const expense of expenses) {
        const participantsQuery = `
          SELECT ep.participant_id, ep.share_amount, p.name, p.user_id
          FROM expense_participants ep
          JOIN participants p ON ep.participant_id = p.id
          WHERE ep.expense_id = ? AND ep.he_participates = TRUE
        `;
        expense.participants = await db.query(participantsQuery, [expense.id]);
      }
      
      return expenses;
    } catch (error) {
      console.error('Error fetching event expenses:', error);
      throw error;
    }
  }

  /**
   * Récupère tous les participants d'un événement
   * @param {number} eventId - ID de l'événement
   * @returns {Array} Liste des participants
   */
  async getEventParticipants(eventId) {
    try {
      const query = `
        SELECT p.id, p.name, p.user_id, u.username
        FROM participants p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.event_id = ?
      `;
      return await db.query(query, [eventId]);
    } catch (error) {
      console.error('Error fetching event participants:', error);
      throw error;
    }
  }

  /**
   * Récupère tous les participants d'un événement à partir du code événement
   * @param {string} eventCode - Code de l'événement
   * @returns {Array} Liste des participants
   */
  async getEventParticipantsByCode(eventCode) {
    try {
      const eventQuery = `SELECT id FROM events WHERE code = ?`;
      const events = await db.query(eventQuery, [eventCode]);
      if (!events || events.length === 0) {
        throw new Error('Event not found');
      }
      const eventId = events[0].id;
      return await this.getEventParticipants(eventId);
    } catch (error) {
      console.error('Erreur lors de la récupération des participants par code:', error);
      throw error;
    }
  }

  /**
   * Optimise les transferts pour minimiser le nombre de transactions (legacy method)
   * @param {Array} debts - Liste des dettes nettes entre participants
   * @param {Array} participants - Liste des participants
   * @returns {Array} Liste optimisée des dettes
   */
  optimizeTransfers(debts, participants) {
    // Cette méthode n'est plus utilisée car l'optimisation se fait maintenant directement dans computeDebts
    console.log('Legacy optimizeTransfers called - returning debts as-is since optimization is now built-in');
    return debts;
  }

  /**
   * Génère les transactions optimales entre créanciers et débiteurs (legacy method)
   * @param {Array} creditors - Liste des créanciers
   * @param {Array} debtors - Liste des débiteurs
   * @returns {Array} Liste optimisée des dettes
   */
  generateOptimalTransactions(creditors, debtors) {
    // Cette méthode n'est plus utilisée
    console.log('Legacy generateOptimalTransactions called');
    return [];
  }
  
  /**
   * Calcule le résumé pour l'utilisateur connecté (legacy method for compatibility)
   * @param {Array} debts - Liste des dettes
   * @param {number} connectedUserId - ID de l'utilisateur connecté
   * @param {Array} participants - Liste des participants
   * @returns {Object} Résumé pour l'utilisateur connecté
   */
  computeUserSummary(debts, connectedUserId, participants) {
    if (!connectedUserId) return null;
    
    const userParticipant = participants.find(p => p.user_id === parseInt(connectedUserId));
    if (!userParticipant) return null;
    
    const userName = userParticipant.name;
    
    let totalToPay = 0;
    let totalToReceive = 0;
    
    const credit = [];
    const debit = [];
    
    debts.forEach(debt => {
      const amount = parseFloat(debt.amount.toFixed(2));
      const originalAmount = debt.originalAmount ? parseFloat(debt.originalAmount.toFixed(2)) : amount;
      const reimbursedAmount = debt.reimbursedAmount ? parseFloat(debt.reimbursedAmount.toFixed(2)) : 0;
      
      if (debt.from === userName) {
        totalToPay += amount;
        debit.push({
          to: debt.to,
          amount: amount,
          originalAmount: originalAmount,
          reimbursedAmount: reimbursedAmount,
          isFullyReimbursed: debt.isFullyReimbursed || false
        });
      }
      
      if (debt.to === userName) {
        totalToReceive += amount;
        credit.push({
          from: debt.from,
          amount: amount,
          originalAmount: originalAmount,
          reimbursedAmount: reimbursedAmount,
          isFullyReimbursed: debt.isFullyReimbursed || false
        });
      }
    });
    
    console.log('Total à recevoir:', totalToReceive);
    console.log('Total à payer:', totalToPay);
    
    return {
      user_id: parseInt(connectedUserId),
      total_to_pay: parseFloat(totalToPay.toFixed(2)),
      total_to_receive: parseFloat(totalToReceive.toFixed(2)),
      credit: credit.sort((a, b) => b.amount - a.amount),
      debit: debit.sort((a, b) => b.amount - a.amount)
    };
  }
}

// Exporter une instance de BalanceService au lieu de la classe
module.exports = new BalanceService(); 