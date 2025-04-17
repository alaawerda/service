const express = require('express');
const app = express();
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const session = require('express-session');
const expenseRoutes = require('./routes/expenseRoutes');
const eventRoutes = require('./routes/eventRoutes');
const routes = require('./routes');

const port = 8081;

app.use(express.json());

app.use(cors({
  origin: ['http://localhost:8081', 'http://localhost:19006', 'http://localhost:19000', 'http://localhost:19001', 'http://localhost:19002'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cookie', 'Access-Control-Allow-Origin'],
  exposedHeaders: ['Set-Cookie'],
  preflightContinue: true,
  optionsSuccessStatus: 200
}));

app.use('/api/expenses', expenseRoutes);

app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    path: '/'
  },
  rolling: true,
  name: 'sessionId'
}));

// Session logging middleware
app.use((req, res, next) => {
 /* console.log('\n=== Session Information ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session Data:', req.session);
  console.log('Cookie Settings:', req.session.cookie);
  console.log('=========================\n');*/
  next();
});

/*// Authentication middleware
const authenticateUser = (req, res, next) => {
  if (!req.session || !req.session.user || !req.session.user.id) {
    console.log('Authentication failed - Invalid session or user data');
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};*/

// Session logging middleware
app.use((req, res, next) => {
  /*console.log('\n=== Session Information ===');
  console.log('Session ID:', req.sessionID);
  console.log('Session Data:', req.session);
  console.log('Cookie Settings:', req.session.cookie);
  console.log('=========================\n');*/
  next();
});

// MySQL connection configuration
const db = require('./db');

// Log database connection
console.log('MySQL pool created and ready for connections');

// Initialize routes
app.use(routes(db));

// Get user data endpoint
app.get('/api/user-data', async (req, res) => {
  try {
    if (!req.session || !req.session.user || !req.session.user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.session.user.id;
    const query = 'SELECT id, username, email FROM users WHERE id = ?';
    
    try {
      const results = await db.query(query, [userId]);
      
      if (!results || results.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const userData = results[0];
      res.json(userData);
    } catch (dbError) {
      console.error('Error fetching user data:', dbError);
      return res.status(500).json({ error: 'Internal server error' });
    }
  } catch (error) {
    console.error('Error in user data endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Create event endpoint
app.post('/api/events', async (req, res) => {
  try {
    const { name, startDate, endDate, currency, splitType, participants, created_by } = req.body;
    const userId = req.query.userId;
    // Validate required fields
    if (!name || !created_by) {
      return res.status(400).json({ error: 'Event name and user ID are required' });
    }
    const generateUniqueEventCode = () => {
      const prefix = 'EV';
      const timestamp = Date.now().toString(36);
      const randomNum = Math.floor(Math.random() * 1000).toString(36);
      return `${created_by}${prefix}${timestamp}${randomNum}`.toUpperCase();
    };
    const eventCode = generateUniqueEventCode();
    
    // Insert event with created_by from request body
    const eventQuery = 'INSERT INTO events (name, start_date, end_date, currency, split_type, created_by,code) VALUES (?, ?, ?, ?, ?, ?,?)';
    const result = await db.query(eventQuery, [name, startDate, endDate, currency, splitType, created_by, eventCode]);
    const eventId = result.insertId;

    // Prepare participants array with valid participants only
    const validParticipants = participants && participants.length > 0 
      ? participants.filter(p => p.name && p.name.trim())
      : [];

    // Insert valid participants
    if (validParticipants.length === 0) {
      return res.status(400).json({ error: 'At least one valid participant is required' });
    }

    // Get username for the logged-in user
    const userQuery = 'SELECT username FROM users WHERE id = ?';
    const userResults = await db.query(userQuery, [created_by]);
    const loggedInUsername = userResults[0]?.username;

    // Insert participants one by one to get their IDs
    const participantQuery = 'INSERT INTO participants (event_id, name, custom_amount, user_id) VALUES (?, ?, ?, ?)';
    // Create participant promises with proper indentation and structure
    const participantPromises = validParticipants.map(p => {
      // Check if this participant matches the logged-in user's username
      const isLoggedInUser = loggedInUsername && p.name.trim() === loggedInUsername;
      
      return db.query(participantQuery, [
        eventId, 
        p.name.trim(), 
        p.customAmount || null, 
        isLoggedInUser ? created_by : null
      ]).then(result => ({ 
        id: result.insertId, 
        name: p.name.trim(),
        user_id: isLoggedInUser ? created_by : null
      }));
    });
    
    const insertedParticipants = await Promise.all(participantPromises);
    res.status(201).json({
      message: 'Event created successfully',
      eventId,
      participants: insertedParticipants
    });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Error creating event' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user exists
    const query = 'SELECT * FROM users WHERE email = ?';
    try {
      const rows = await db.query(query, [email]);
      
      if (!rows || rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = rows[0];
      
      // Compare password
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Store user data in session
      req.session.user = {
        id: user.id,
        email: user.email,
        username: user.username
      };

      res.json({ message: 'Login successful', user: { id: user.id, email: user.email, username: user.username } });
    } catch (dbError) {
      console.error('Database error:', dbError);
      return res.status(500).json({ error: 'Database error' });
    }
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Register endpoint
// User session verification endpoint
/*app.get('/api/user', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({
    id: req.session.user.id,
    email: req.session.user.email,
    username: req.session.user.username
  });
});
*/
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;

    // Validate input
    if (!email || !password || !username) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user already exists
    const checkQuery = 'SELECT * FROM users WHERE email = ?';
    try {
      const [rows] = await db.query(checkQuery, [email]);
      
      if (rows && rows.length > 0) {
        return res.status(400).json({ error: 'User already exists' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert new user
      const insertQuery = 'INSERT INTO users (email, password, username) VALUES (?, ?, ?)';
      const [result] = await db.query(insertQuery, [email, hashedPassword, username]);
      const userId = result.insertId;
      
      // Store user data in session
      req.session.user = {
        id: userId,
        email: email,
        username: username
      };

      res.status(201).json({ message: 'User registered successfully' });
    } catch (dbError) {
      console.error('Database error:', dbError);
      return res.status(500).json({ error: 'Error creating user' });
    }
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user's events endpoint
app.get('/api/user-events', async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const query = `
      SELECT DISTINCT e.*, 
        GROUP_CONCAT(DISTINCT p.name) as participant_names,
        GROUP_CONCAT(DISTINCT p.custom_amount) as participant_amounts,
        COUNT( DISTINCT ex.id) as expenseCount,  -- Count of expenses
        COALESCE(SUM(ex.amount) / NULLIF(COUNT(DISTINCT p.id), 0), 0) as totalExpenseAmount  -- Sum of expense amounts
      FROM events e
      LEFT JOIN participants p ON e.id = p.event_id
      LEFT JOIN expenses ex ON e.id = ex.event_id  -- Join with expenses table
      WHERE e.created_by = ? 
        OR EXISTS (SELECT 1 FROM participants p2 WHERE p2.event_id = e.id AND p2.name = (SELECT username FROM users WHERE id = ?))
      GROUP BY e.id
      ORDER BY e.created_at DESC
    `;

    const results = await db.query(query, [userId, userId]);
    
    // Process the results to format participant data
    const formattedResults = results.map(event => ({
      ...event,
      participants: event.participant_names
        ? event.participant_names.split(',').map((name, index) => ({
            name,
            customAmount: event.participant_amounts
              ? event.participant_amounts.split(',')[index] || null
              : null
          })).filter(p => p.name && p.name.trim()) // Filter out null or blank usernames
        : [],
    }));

    res.json(formattedResults);
  } catch (err) {
    console.error('Database error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Get expense participants endpoint
app.get('/api/expense-participants/:expenseId', async (req, res) => {
  try {
    const { expenseId } = req.params;

    if (!expenseId) {
      return res.status(400).json({ error: 'Expense ID is required' });
    }

    const query = `
      SELECT ep.*, e.description as expense_description, e.amount as expense_amount, e.split_type
      FROM expense_participants ep
      JOIN expenses e ON ep.expense_id = e.id
      WHERE ep.expense_id = ?
    `;

    const results = await db.query(query, [expenseId]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'No participants found for this expense' });
    }

    res.json(results);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create expense endpoint
app.post('/api/expenses', async (req, res) => {
  try {
    console.log('[Create Expense] Request body:', JSON.stringify(req.body));
    const { description, amount, groupId, paidBy, createdDate, split_type, selectedParticipants, customAmounts, shares, receiptImage } = req.body;

    // Validate required fields
    if (!description || !amount || !paidBy || !split_type || !selectedParticipants || paidBy === undefined || paidBy === null) { // Added explicit check for paidBy
      console.log('[Create Expense] Missing required fields:', { description, amount, paidBy, split_type, selectedParticipants });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // *** START CHANGE: Add explicit checks for groupId and createdDate ***
    if (groupId === undefined || groupId === null) {
        console.log('[Create Expense] Missing required field: groupId');
        return res.status(400).json({ error: 'Missing required field: groupId' });
    }
    // Use current date if createdDate is not provided or invalid
    const expenseDate = createdDate ? new Date(createdDate) : new Date();
    if (isNaN(expenseDate.getTime())) {
        console.warn('[Create Expense] Invalid createdDate received, using current date instead:', createdDate);
        // Optionally return an error if date must be valid
        // return res.status(400).json({ error: 'Invalid createdDate format' });
        expenseDate = new Date(); // Explicitly assign a valid date if the provided one was invalid
     }
     // *** END CHANGE ***

    // *** START DIAGNOSTIC LOGGING ***
    console.log('[Create Expense] Preparing to insert expense. Parameters:');
    console.log(`  description: ${description} (type: ${typeof description})`);
    console.log(`  amount: ${amount} (type: ${typeof amount})`);
    console.log(`  groupId: ${groupId} (type: ${typeof groupId})`);
    console.log(`  paidBy: ${paidBy} (type: ${typeof paidBy})`);
    console.log(`  expenseDate: ${expenseDate} (type: ${typeof expenseDate}, value: ${expenseDate instanceof Date ? expenseDate.toISOString() : expenseDate})`);
    console.log(`  split_type: ${split_type} (type: ${typeof split_type})`);
    console.log(`  receiptImage: ${receiptImage} (type: ${typeof receiptImage})`);
    const finalReceiptImage = receiptImage || null;
    console.log(`  finalReceiptImage (passed to query): ${finalReceiptImage} (type: ${typeof finalReceiptImage})`);
    // *** END DIAGNOSTIC LOGGING ***

     // Insert expense
     const expenseQuery = 'INSERT INTO expenses (description, amount, event_id, paid_by, created_date, split_type, receipt_image) VALUES (?, ?, ?, ?, ?, ?, ?)';
       // Ensure receiptImage is null if undefined or falsy
       // Use the validated/defaulted expenseDate
    const result = await db.query(expenseQuery, [description, amount, groupId, paidBy, expenseDate, split_type, finalReceiptImage]); // Use finalReceiptImage
     const expenseId = result.insertId;
 
     // *** START CHANGE: Add check for valid expenseId ***
    if (expenseId === undefined || expenseId === null || isNaN(expenseId)) {
      console.error('[Create Expense] Error: Failed to retrieve a valid expense ID after insertion.');
      return res.status(500).json({ error: 'Internal server error creating expense record.' });
    }
    console.log(`[Create Expense] Expense inserted with ID: ${expenseId}`);
    // *** END CHANGE ***

    // Get valid participant IDs from the participants table
    let participantQuery = 'SELECT id, name FROM participants WHERE event_id = ?';
    const participantNames = selectedParticipants
      .filter(p => p && typeof p === 'string' && p.trim())
      .map(p => p.trim());

    console.log('[Create Expense] selectedParticipants:', selectedParticipants);
    console.log('[Create Expense] participantNames:', participantNames);

    if (participantNames.length === 0) {
      console.log('[Create Expense] Aucun participant sélectionné valide.');
      return res.status(400).json({ error: 'No valid participants selected' });
    }

    // Construire la requête SQL pour récupérer les participants existants
    if (participantNames.length > 0) {
      participantQuery += ' AND (';
      const placeholders = participantNames.map(() => 'name = ?').join(' OR ');
      participantQuery += placeholders + ')';
    }

    const queryParams = [groupId, ...participantNames];
    console.log('[Create Expense] Requête participants:', participantQuery);
    console.log('[Create Expense] Paramètres de requête:', queryParams);

    const participantResults = await db.query(participantQuery, queryParams);
    console.log('[Create Expense] Résultats de la requête participants:', participantResults);

    // Correction : s'assurer que participantResults est un tableau d'objets avec id et name
    const validParticipants = Array.isArray(participantResults)
      ? participantResults.filter(participant => participant && participant.name && participant.id)
      : [];

    console.log('[Create Expense] validParticipants:', validParticipants);

    if (validParticipants.length === 0) {
      console.log('[Create Expense] Aucun participant valide trouvé en base.');
      return res.status(400).json({ error: 'No valid participants found' });
    }

    console.log('[Create Expense] Processing participants with split type:', split_type);
    console.log('[Create Expense] Custom amounts:', JSON.stringify(customAmounts));
    console.log('[Create Expense] Shares:', JSON.stringify(shares));
    
    const participantValues = validParticipants.map(participant => {
      let shareAmount = 0; // Initialize with a default value
      const participantName = participant.name; // Use participant name for lookups

      if (!participant || participant.id === undefined || participant.id === null) {
        console.error(`[Create Expense] Invalid participant data found:`, participant);
        // Skip this participant or handle error appropriately
        return null; // Mark as invalid to filter out later
      }

      try {
        if (split_type === 'equal') {
          shareAmount = amount / validParticipants.length;
        } else if (split_type === 'custom') {
          const customAmountsObj = customAmounts && typeof customAmounts === 'object' ? customAmounts : {};
          const customAmountStr = customAmountsObj[participantName] !== undefined ? String(customAmountsObj[participantName]) : '0';
          console.log(`[Create Expense] Custom amount string for ${participantName}:`, customAmountStr);
          shareAmount = parseFloat(customAmountStr);
          if (isNaN(shareAmount) || shareAmount < 0) {
            console.warn(`[Create Expense] Invalid or negative custom amount for ${participantName}: ${customAmountStr}. Defaulting to 0.`);
            shareAmount = 0; // Default to 0 if invalid
          }
        } else { // shares
          const sharesObj = shares && typeof shares === 'object' ? shares : {};
          const shareValueStr = sharesObj[participantName] !== undefined ? String(sharesObj[participantName]) : '1';
          console.log(`[Create Expense] Share string for ${participantName}:`, shareValueStr);
          let participantShare = parseFloat(shareValueStr);
          if (isNaN(participantShare) || participantShare < 0) {
            console.warn(`[Create Expense] Invalid or negative share for ${participantName}: ${shareValueStr}. Defaulting to 0.`);
            participantShare = 0; // Default to 0 if invalid
          }

          const totalShares = validParticipants.reduce((sum, p) => {
            const pShareValueStr = sharesObj[p.name] !== undefined ? String(sharesObj[p.name]) : '1';
            const pShare = parseFloat(pShareValueStr);
            // Use 0 for invalid/negative shares in sum calculation
            return sum + (isNaN(pShare) || pShare < 0 ? 0 : pShare);
          }, 0);

          console.log(`[Create Expense] Total valid shares:`, totalShares);
          // Avoid division by zero
          shareAmount = totalShares > 0 ? (amount * participantShare) / totalShares : 0;
        }

        // Ensure shareAmount is a non-negative number, rounded to 2 decimal places
        shareAmount = parseFloat(Math.max(0, shareAmount).toFixed(2));
        if (isNaN(shareAmount)) {
          console.error(`[Create Expense] Calculated shareAmount is NaN for ${participantName}. Defaulting to 0.`);
          shareAmount = 0;
        }
      } catch (calcError) {
        console.error(`[Create Expense] Error calculating share for ${participantName}:`, calcError);
        shareAmount = 0; // Default to 0 in case of calculation error
      }

      // *** START CHANGE: Add explicit checks before returning the array ***
      if (expenseId === undefined || participant.id === undefined || shareAmount === undefined || isNaN(shareAmount)) {
        console.error(`[Create Expense] Error: Invalid data detected before creating participant value array for participant ${participant.id}:`, { expenseId, participantId: participant.id, shareAmount });
        return null;
      }
      // *** END CHANGE ***

      // console.log(`[Create Expense] Calculated share for ${participantName}:`, shareAmount);
      return [expenseId, participant.id, shareAmount];
    });

    // Filter out any invalid participant values (nulls)
    const safeValues = participantValues.filter(row => Array.isArray(row) && row.length === 3 && row.every(val => val !== undefined && val !== null && !isNaN(val)));
    if (safeValues.length === 0) {
      console.error('[Create Expense] No valid participant values to insert into expense_participants.');
      return res.status(400).json({ error: 'No valid participant values to insert.' });
    }

    // Insert expense participants (bulk insert)
    const expenseParticipantValues = validParticipants.map(participant => {
      let shareAmount = 0;
      const participantName = participant.name;
      if (split_type === 'equal') {
        shareAmount = amount / validParticipants.length;
      } else if (split_type === 'custom') {
        const customAmountsObj = customAmounts && typeof customAmounts === 'object' ? customAmounts : {};
        const customAmountStr = customAmountsObj[participantName] !== undefined ? String(customAmountsObj[participantName]) : '0';
        shareAmount = parseFloat(customAmountStr);
        if (isNaN(shareAmount) || shareAmount < 0) shareAmount = 0;
      } else {
        const sharesObj = shares && typeof shares === 'object' ? shares : {};
        const shareValueStr = sharesObj[participantName] !== undefined ? String(sharesObj[participantName]) : '1';
        let participantShare = parseFloat(shareValueStr);
        if (isNaN(participantShare) || participantShare < 0) participantShare = 0;
        const totalShares = validParticipants.reduce((sum, p) => {
          const pShareValueStr = sharesObj[p.name] !== undefined ? String(sharesObj[p.name]) : '1';
          const pShare = parseFloat(pShareValueStr);
          return sum + (isNaN(pShare) || pShare < 0 ? 0 : pShare);
        }, 0);
        shareAmount = totalShares > 0 ? (amount * participantShare) / totalShares : 0;
      }
      shareAmount = parseFloat(Math.max(0, shareAmount).toFixed(2));
      return [expenseId, participant.id, shareAmount, 1];
    }).filter(arr => arr.every(val => val !== undefined && val !== null && !isNaN(val)));

    if (expenseParticipantValues.length === 0) {
      console.error('[Create Expense] No valid expense participants to insert.');
      return res.status(400).json({ error: 'No valid expense participants to insert' });
    }

    const placeholders = expenseParticipantValues.map(() => '(?, ?, ?, ?)').join(', ');
    const flatValues = expenseParticipantValues.flat();
    const insertExpenseParticipantsQuery = `INSERT INTO expense_participants (expense_id, participant_id, share_amount, he_participates) VALUES ${placeholders}`;
    try {
      await db.query(insertExpenseParticipantsQuery, flatValues);
      console.log('[Create Expense] Expense participants inserted successfully.');
    } catch (insertErr) {
      console.error('[Create Expense] Error inserting expense participants:', insertErr);
      return res.status(500).json({ error: 'Error inserting expense participants' });
    }
    res.status(201).json({ message: 'Expense created successfully', expenseId });
  } catch (error) {
    console.error('[Create Expense] Error:', error);
    res.status(500).json({ error: 'Error creating expense' });
  }
});
  

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});