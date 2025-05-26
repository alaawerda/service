const express = require('express');
const app = express();
const bcrypt = require('bcrypt');
const session = require('express-session');
const sharp = require('sharp');
const expenseRoutes = require('./routes/expenseRoutes');
const eventRoutes = require('./routes/eventRoutes');
const db = require('./db');
const routes = require('./routes')(db);
const authRoutes = require('./routes/authRoutes')(db);
const reimbursementRoutes = require('./routes/reimbursementRoutes')(db);

// Import our custom CORS middleware
const { corsMiddleware, additionalCorsHeaders, optionsCorsHandler } = require('./middleware/corsMiddleware');

// Configuration des variables d'environnement pour Google OAuth
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'VOTRE_GOOGLE_CLIENT_ID';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'VOTRE_GOOGLE_CLIENT_SECRET';

const port = 8081;

// Apply CORS middleware (should come before other middleware)
app.use(corsMiddleware);

// Handle preflight OPTIONS requests
app.options('*', optionsCorsHandler);

// Apply additional CORS headers to all responses
app.use(additionalCorsHeaders);

// Parse JSON bodies (must come after CORS)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use('/api/expenses', expenseRoutes);

// Log database connection
console.log('MySQL pool created and ready for connections');

// Initialize routes
app.use(routes);
app.use(authRoutes);
app.use(reimbursementRoutes);

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
    console.log('[LOGIN] Requête reçue sur /api/login');
    console.log('[LOGIN] Headers:', req.headers);
    console.log('[LOGIN] Body:', req.body);
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      console.log('[LOGIN] Validation échouée: email ou mot de passe manquant');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user exists
    const query = 'SELECT * FROM users WHERE email = ?';
    try {
      const rows = await db.query(query, [email]);
      console.log('[LOGIN] Résultat de la requête utilisateur:', rows);
      if (!rows || rows.length === 0) {
        console.log('[LOGIN] Aucun utilisateur trouvé pour cet email');
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
app.get('/api/user', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({
    id: req.session.user.id,
    email: req.session.user.email,
    username: req.session.user.username
  });
});
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
      const rows = await db.query(checkQuery, [email]);
      
      if (rows && rows.length > 0) {
        return res.status(400).json({ error: 'User already exists' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert new user
      const insertQuery = 'INSERT INTO users (email, password, username) VALUES (?, ?, ?)';
      const result = await db.query(insertQuery, [email, hashedPassword, username]);
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
      // Retourner le message SQL brut pour les doublons (username/email)
      if (dbError.code === 'ER_DUP_ENTRY') {
        const sqlMsg = dbError.sqlMessage || 'Duplicate entry';
        return res.status(400).json({ error: sqlMsg });
      }
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
    
    // D'abord, récupérer les IDs des événements auxquels l'utilisateur participe
    const eventIdsQuery = `
      SELECT DISTINCT e.id
      FROM events e
      LEFT JOIN participants p ON e.id = p.event_id
      WHERE e.created_by = ? OR p.user_id = ?
    `;
    
    const eventIdsResults = await db.query(eventIdsQuery, [userId, userId]);
    
    if (!eventIdsResults || eventIdsResults.length === 0) {
      return res.json([]);
    }
    
    // Extraire les IDs des événements
    const eventIds = eventIdsResults.map(row => row.id);
    
    // Ensuite, récupérer tous les détails des événements avec tous leurs participants
    const query = `
      SELECT DISTINCT e.*, 
        GROUP_CONCAT(DISTINCT p.name) as participant_names,
        GROUP_CONCAT(DISTINCT p.custom_amount) as participant_amounts,
        COUNT(DISTINCT ex.id) as expenseCount,  -- Count of expenses
        COALESCE(SUM(ex.amount) / NULLIF(COUNT(DISTINCT p.id), 0), 0) as totalExpenseAmount  -- Sum of expense amounts
      FROM events e
      LEFT JOIN participants p ON e.id = p.event_id
      LEFT JOIN expenses ex ON e.id = ex.event_id  -- Join with expenses table
      WHERE e.id IN (${eventIds.map(() => '?').join(',')})
      GROUP BY e.id
      ORDER BY e.created_at DESC
    `;

    const results = await db.query(query, [...eventIds]);
    
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

// Fonction pour compresser l'image base64
async function compressBase64Image(base64String, maxWidth = 800) {
  try {
    // Log only the size of the image, not the content
    const originalSize = Math.ceil((base64String.length * 3) / 4);
    console.log(`[Image Compression] Original size: ${Math.round(originalSize / 1024)} KB`);

    // Extraire le type MIME et les données base64
    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 image format');
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    
    // Convertir base64 en Buffer
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    // Compresser l'image avec sharp
    const compressedBuffer = await sharp(imageBuffer)
      .resize(maxWidth, null, {
        withoutEnlargement: true,
        fit: 'inside'
      })
      .jpeg({ quality: 70 }) // Convertir en JPEG avec qualité réduite
      .toBuffer();
    
    // Convertir le buffer compressé en base64
    const compressedBase64 = `data:${mimeType};base64,${compressedBuffer.toString('base64')}`;
    
    // Log only the size of the compressed image
    const compressedSize = Math.ceil((compressedBase64.length * 3) / 4);
    console.log(`[Image Compression] Compressed size: ${Math.round(compressedSize / 1024)} KB`);
    console.log(`[Image Compression] Compression ratio: ${Math.round((compressedSize / originalSize) * 100)}%`);

    return compressedBase64;
  } catch (error) {
    console.error('[Image Compression] Error:', error.message);
    throw error;
  }
}

// Create expense endpoint
app.post('/api/expenses', async (req, res) => {
  try {
    console.log('[Create Expense] Starting expense creation...');
    console.log('[Create Expense] Request body:', JSON.stringify(req.body, null, 2));
    const { description, amount, groupId, paidBy, createdDate, split_type, selectedParticipants, customAmounts, shares, receiptImage } = req.body;

    // Validate required fields with detailed logging
    console.log('[Create Expense] Validating required fields...');
    const requiredFields = {
      description,
      amount,
      paidBy,
      split_type,
      selectedParticipants,
      groupId
    };
    
    const missingFields = Object.entries(requiredFields)
      .filter(([_, value]) => value === undefined || value === null || value === '')
      .map(([key]) => key);

    if (missingFields.length > 0) {
      console.log('[Create Expense] Missing required fields:', missingFields);
      return res.status(400).json({ 
        error: 'Missing required fields',
        missingFields 
      });
    }

    // Validate and compress receipt image if provided
    console.log('[Create Expense] Validating receipt image...');
    let validatedReceiptImage = null;
    if (receiptImage) {
      console.log('[Create Expense] Receipt image provided');
      if (typeof receiptImage === 'string') {
        if (receiptImage.startsWith('data:image/')) {
          try {
            validatedReceiptImage = await compressBase64Image(receiptImage);
            console.log('[Create Expense] Image compressed successfully');
          } catch (compressError) {
            console.error('[Create Expense] Error compressing image:', compressError.message);
            // If compression fails, use original image but log a warning
            console.warn('[Create Expense] Using original image due to compression failure');
            validatedReceiptImage = receiptImage;
          }
        } else if (receiptImage.startsWith('http://') || receiptImage.startsWith('https://')) {
          console.log('[Create Expense] Processing URL image');
          validatedReceiptImage = receiptImage;
        } else {
          console.warn('[Create Expense] Invalid image format - must be base64 or URL');
          return res.status(400).json({ error: 'Invalid image format - must be base64 or URL' });
        }
      } else {
        console.warn('[Create Expense] Receipt image must be a string');
        return res.status(400).json({ error: 'Receipt image must be a string' });
      }
    } else {
      console.log('[Create Expense] No receipt image provided');
    }

    // Validate and process date
    console.log('[Create Expense] Processing date...');
    let expenseDate;
    try {
      expenseDate = createdDate ? new Date(createdDate) : new Date();
      if (isNaN(expenseDate.getTime())) {
        console.warn('[Create Expense] Invalid date format, using current date');
        expenseDate = new Date();
      }
      console.log('[Create Expense] Using date:', expenseDate.toISOString());
    } catch (dateError) {
      console.error('[Create Expense] Error processing date:', dateError);
      expenseDate = new Date();
    }

    // Insert expense with detailed logging
    console.log('[Create Expense] Preparing to insert expense into database...');
    const expenseQuery = 'INSERT INTO expenses (description, amount, event_id, paid_by, created_date, split_type, receipt_image) VALUES (?, ?, ?, ?, ?, ?, ?)';
    const expenseParams = [
      description,
      amount,
      groupId,
      paidBy,
      expenseDate,
      split_type,
      validatedReceiptImage
    ];
    
    console.log('[Create Expense] Query parameters:', {
      description,
      amount,
      groupId,
      paidBy,
      expenseDate: expenseDate.toISOString(),
      split_type,
      hasReceiptImage: !!validatedReceiptImage
    });

    try {
      const result = await db.query(expenseQuery, expenseParams);
      console.log('[Create Expense] Expense inserted successfully, ID:', result.insertId);
      const expenseId = result.insertId;

      if (!expenseId) {
        console.error('[Create Expense] No expense ID returned from database');
        return res.status(500).json({ error: 'Failed to create expense - no ID returned' });
      }

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
        // Calculate share_count ONLY for 'shares' type
        let shareCount = null; // Default to null
        if (split_type === 'shares') {
          const sharesObj = shares && typeof shares === 'object' ? shares : {};
          const shareValueStr = sharesObj[participantName] !== undefined ? String(sharesObj[participantName]) : '1';
          const calculatedShare = parseFloat(shareValueStr);
          // Use calculated share if valid and non-negative, otherwise default to 1
          shareCount = (!isNaN(calculatedShare) && calculatedShare >= 0) ? calculatedShare : 1;
        }

        // Only include shareCount if split_type is 'shares'
        return split_type === 'shares' 
          ? [expenseId, participant.id, shareAmount, 1, shareCount] 
          : [expenseId, participant.id, shareAmount, 1]
      }).filter(arr => arr.every(val => val !== undefined && val !== null && !isNaN(val)));

      if (expenseParticipantValues.length === 0) {
        console.error('[Create Expense] No valid expense participants to insert.');
        return res.status(400).json({ error: 'No valid expense participants to insert' });
      }

      // Determine if we need to include share_count in the query
      const includeShareCount = split_type === 'shares';
      const placeholders = expenseParticipantValues.map(() => 
        includeShareCount ? '(?, ?, ?, ?, ?)' : '(?, ?, ?, ?)'
      ).join(', ');
      const flatValues = expenseParticipantValues.flat();
      
      // Build the query based on split_type
      const insertExpenseParticipantsQuery = includeShareCount
        ? `INSERT INTO expense_participants (expense_id, participant_id, share_amount, he_participates, share_count) VALUES ${placeholders}`
        : `INSERT INTO expense_participants (expense_id, participant_id, share_amount, he_participates) VALUES ${placeholders}`;
      try {
        await db.query(insertExpenseParticipantsQuery, flatValues);
        console.log('[Create Expense] Expense participants inserted successfully.');
      } catch (insertErr) {
        console.error('[Create Expense] Error inserting expense participants:', insertErr);
        return res.status(500).json({ error: 'Error inserting expense participants' });
      }

      // Ajouter les participants non sélectionnés avec share_amount=0, he_participates=0
      try {
        // Obtenir tous les participants de l'événement
        const allParticipants = await db.query('SELECT id FROM participants WHERE event_id = ?', [groupId]);
        const selectedIds = validParticipants.map(p => p.id);
        const deselectedIds = allParticipants
          .map(p => p.id)
          .filter(id => !selectedIds.includes(id));
        if (deselectedIds.length > 0) {
          const deselectedValues = deselectedIds.map(id => [expenseId, id, 0, 0]);
          const placeholders2 = deselectedValues.map(() => '(?, ?, ?, ?)').join(', ');
          const flatDeselected = deselectedValues.flat();
          await db.query(
            `INSERT INTO expense_participants (expense_id, participant_id, share_amount, he_participates) VALUES ${placeholders2}`,
            flatDeselected
          );
          console.log('[Create Expense] Deselected participants inserted with zero share.');
        }
      } catch (errDeselected) {
        console.error('[Create Expense] Error inserting deselected participants:', errDeselected);
        return res.status(500).json({ error: 'Error inserting deselected participants' });
      }
      res.status(201).json({ message: 'Expense created successfully', expenseId });
    } catch (dbError) {
      console.error('[Create Expense] Database error during expense insertion:', dbError);
      console.error('[Create Expense] SQL State:', dbError.sqlState);
      console.error('[Create Expense] Error Code:', dbError.code);
      console.error('[Create Expense] Error Message:', dbError.message);
      return res.status(500).json({ 
        error: 'Database error while creating expense',
        details: {
          code: dbError.code,
          sqlState: dbError.sqlState,
          message: dbError.message
        }
      });
    }
  } catch (error) {
    console.error('[Create Expense] Unexpected error:', error);
    console.error('[Create Expense] Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Unexpected error while creating expense',
      details: error.message
    });
  }
});
  

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});