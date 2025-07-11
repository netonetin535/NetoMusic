const express = require('express');
const multer = require('multer');
const session = require('express-session');
const FileStore = require('session-file-store')(session); // Atualizado para session-file-store
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Credenciais de login
const ADMIN_USER = 'admin';
const ADMIN_PASS = '123456';

// Uploads configurados com limite de tamanho (10MB por arquivo)
const upload = multer({
  dest: 'public/uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // Limite de 10MB por arquivo
});

// Middlewares
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração da sessão com FileStore
app.use(session({
  store: new FileStore({
    path: path.join(__dirname, 'sessions'), // Pasta para armazenar sessões
    ttl: 24 * 60 * 60 // Tempo de vida da sessão (24 horas)
  }),
  secret: 'secreto-cds',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));

// Banco de dados local
const dbPath = './cds.json';
function loadCDs() {
  return fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath)) : [];
}
let cds = loadCDs(); // Carrega apenas no início

function saveCDs(cdsData) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(cdsData, null, 2));
    console.log('cds.json salvo com sucesso.');
  } catch (err) {
    console.error('Erro ao salvar cds.json:', err.message);
    throw new Error('Falha ao salvar banco de dados');
  }
}

// Rota de login admin
app.get('/admin', (req, res) => {
  if (req.session.logado) return res.redirect('/admin/admin.html');
  res.sendFile(__dirname + '/public/admin/login.html');
});

// Processa login
app.post('/login', (req, res) => {
  const { user, pass } = req.body;
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    req.session.logado = true;
    return res.redirect('/admin/admin.html');
  }
  res.send('<p>Login inválido. <a href="/admin">Tentar novamente</a></p>');
});

// Protege a página admin
app.use('/admin/admin.html', (req, res, next) => {
  if (!req.session.logado) return res.redirect('/admin');
  next();
});

// Upload de novo CD
app.post('/api/upload', upload.fields([
  { name: 'capa', maxCount: 1 },
  { name: 'zip', maxCount: 1 },
  { name: 'faixas' }
]), (req, res) => {
  if (!req.session.logado) return res.status(403).json({ message: 'Acesso proibido. Faça login.' });

  const nome = req.body.nome;
  const instagram = req.body.instagram || "";
  const suamusica = req.body.suamusica || "";
  const capa = req.files['capa'] ? req.files['capa'][0] : null;
  const zip = req.files['zip'] ? req.files['zip'][0] : null;
  const faixas = req.files['faixas'] || [];

  if (!nome || !capa || !zip || !faixas.length) {
    return res.status(400).json({ message: 'Campos obrigatórios faltando (nome, capa, zip ou faixas).' });
  }

  const faixaInfos = faixas.map(faixa => ({
    nome: faixa.originalname.replace('.mp3', ''),
    arquivo: `/uploads/${faixa.filename}`
  }));

  const cd = {
    id: Date.now(),
    nome,
    capa: `/uploads/${capa.filename}`,
    zip: `/uploads/${zip.filename}`,
    zipOriginal: zip.originalname,
    faixas: faixaInfos,
    instagram,
    suamusica
  };

  try {
    let cds = loadCDs(); // Recarrega do disco
    cds.unshift(cd);
    saveCDs(cds); // Salva imediatamente após adicionar
    res.redirect('/admin/admin.html');
  } catch (err) {
    res.status(500).json({ message: `Erro ao salvar CD: ${err.message}` });
  }
});

// API pública para listar CDs
app.get('/api/cds', (req, res) => {
  res.json(loadCDs()); // Recarrega do disco a cada requisição
});

// Rota para baixar o ZIP com o nome original
app.get('/api/download/:id', (req, res) => {
  const { id } = req.params;
  const cds = loadCDs(); // Recarrega do disco
  const cd = cds.find(cd => cd.id == id);
  if (!cd) {
    return res.status(404).json({ message: 'CD não encontrado.' });
  }

  const filePath = path.join(__dirname, 'public', cd.zip);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'Arquivo ZIP não encontrado no servidor.' });
  }

  res.download(filePath, cd.zipOriginal, (err) => {
    if (err && !res.headersSent) {
      console.error('Erro ao baixar arquivo:', err.message);
      res.status(500).json({ message: `Erro ao baixar arquivo: ${err.message}` });
    }
  });
});

// Rota para remover um CD
app.post('/api/remover', (req, res) => {
  if (!req.session.logado) {
    return res.status(403).json({ message: 'Acesso proibido. Faça login.' });
  }

  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ message: 'ID do CD não fornecido.' });
  }

  let cds = loadCDs(); // Recarrega do disco
  const index = cds.findIndex(cd => cd.id == id);
  if (index === -1) {
    return res.status(404).json({ message: 'CD não encontrado.' });
  }

  const cd = cds[index];

  // Tentar excluir arquivos físicos
  try {
    if (fs.existsSync('public' + cd.capa)) {
      fs.unlinkSync('public' + cd.capa);
    } else {
      console.warn(`Arquivo de capa não encontrado: ${cd.capa}`);
    }

    if (fs.existsSync('public' + cd.zip)) {
      fs.unlinkSync('public' + cd.zip);
    } else {
      console.warn(`Arquivo ZIP não encontrado: ${cd.zip}`);
    }

    for (const faixa of cd.faixas) {
      if (fs.existsSync('public' + faixa.arquivo)) {
        fs.unlinkSync('public' + faixa.arquivo);
      } else {
        console.warn(`Arquivo de faixa não encontrado: ${faixa.arquivo}`);
      }
    }
  } catch (err) {
    console.error('Erro ao excluir arquivos:', err.message);
    return res.status(500).json({ message: `Erro ao excluir arquivos: ${err.message}` });
  }

  // Atualizar o banco de dados
  try {
    cds.splice(index, 1);
    saveCDs(cds); // Salva diretamente
    res.status(200).json({ message: 'CD removido com sucesso.' });
  } catch (err) {
    console.error('Erro ao atualizar cds.json:', err.message);
    return res.status(500).json({ message: `Erro ao atualizar banco de dados: ${err.message}` });
  }
});

// Inicia servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

// Cria a pasta de sessões se não existir
const sessionPath = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionPath)) {
  fs.mkdirSync(sessionPath);
}
