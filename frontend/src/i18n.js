// Translates what's on screen by exact match, so every screen stays written in plain English.
// A string missing here simply stays in English; add it to the table below.
const FR = {
  Dashboard: 'Tableau de bord', Attendance: 'Présence', Timesheets: 'Feuilles de temps', Leave: 'Congés', Calendar: 'Calendrier', Chat: 'Messagerie', 'People & Birthdays': 'Personnes et anniversaires',
  Projects: 'Projets', Tasks: 'Tâches', Appraisals: 'Évaluations', 'My Payslips': 'Mes fiches de paie', 'My Profile': 'Mon profil', Settings: 'Paramètres', Logout: 'Déconnexion', Workspace: 'Espace de travail',
  'My crew': 'Mon équipe', 'My team': 'Mon équipe', 'HR admin': 'Administration RH', System: 'Système', Employees: 'Employés', Contracts: 'Contrats', Payroll: 'Paie', 'All Approvals': 'Toutes les approbations',
  'Change Requests': 'Demandes de modification', 'Policies & Rules': 'Politiques et règles', Reports: 'Rapports', 'Audit Log': "Journal d'audit", 'System Health': 'État du système', 'Roles & Permissions': 'Rôles et permissions',
  Integrations: 'Intégrations', 'System Settings': 'Paramètres système', 'Crew & Approvals': 'Équipe et approbations', 'Team & Approvals': 'Équipe et approbations', 'Team Reports': "Rapports d'équipe", 'Crew Reports': "Rapports d'équipe",
  'Check In': 'Pointer', 'Check Out': 'Dépointer', 'Check out': 'Dépointer', Save: 'Enregistrer', Cancel: 'Annuler', Add: 'Ajouter', Edit: 'Modifier', Delete: 'Supprimer', New: 'Nouveau', Close: 'Fermer', Search: 'Rechercher',
  Today: "Aujourd'hui", Week: 'Semaine', Day: 'Jour', Month: 'Mois', Agenda: 'Agenda', Grid: 'Grille', List: 'Liste', Entries: 'Entrées', Start: 'Démarrer', START: 'DÉMARRER', Stop: 'Arrêter', Total: 'Total',
  Approve: 'Approuver', Refuse: 'Refuser', Validate: 'Valider', Review: 'Examiner', Join: 'Rejoindre', Send: 'Envoyer', Message: 'Message', Availability: 'Disponibilité', Export: 'Exporter', Print: 'Imprimer', Back: 'Retour',
  Date: 'Date', Project: 'Projet', Task: 'Tâche', Description: 'Description', Status: 'Statut', Employee: 'Employé', Manager: 'Responsable', Position: 'Poste', Department: 'Département', Role: 'Rôle', Team: 'Équipe', Reason: 'Motif',
  'Check in': 'Pointage', Worked: 'Travaillé', Action: 'Action', 'Time spent': 'Temps passé', 'Person assisted': 'Personne assistée', 'Add a line': 'Ajouter une ligne', 'Total logged': 'Total saisi', 'Attendance (from check-in)': 'Présence (pointage)',
  'My Attendance': 'Ma présence', 'My Timesheets': 'Mes feuilles de temps', 'Your check-in and check-out records': 'Vos enregistrements de pointage', 'Leave balances': 'Soldes de congés', 'Timesheet this week': 'Feuille de temps de la semaine',
  'My requests': 'Mes demandes', "Today's meetings": 'Réunions du jour', Birthdays: 'Anniversaires', Announcements: 'Annonces', 'This week': 'Cette semaine', 'New request': 'Nouvelle demande', 'Leave type': 'Type de congé', From: 'Du', To: 'Au',
  'Submit request': 'Soumettre la demande', 'Apply for leave': 'Demander un congé', Submitted: 'Soumis', Approved: 'Approuvé', Refused: 'Refusé', Cancelled: 'Annulé', Draft: 'Brouillon', 'On time': "À l'heure", 'In progress': 'En cours', Absent: 'Absent',
  'On leave': 'En congé', 'Checked in': 'Pointé', 'Checked out': 'Sorti', Edited: 'Modifié', Validated: 'Validé', 'To validate': 'À valider', 'Approval inbox': "Boîte d'approbation", Directory: 'Annuaire', 'Upcoming birthdays': 'Prochains anniversaires',
  'Work anniversaries': 'Anniversaires de service', 'New joiners': 'Nouveaux arrivants', 'Your privacy': 'Votre vie privée', Personal: 'Personnel', Contact: 'Contact', 'Emergency contact': "Contact d'urgence", 'Banking details': 'Coordonnées bancaires',
  'Change history': 'Historique des modifications', 'Change photo': 'Changer la photo', 'Save changes': 'Enregistrer', Discard: 'Annuler', 'Account & security': 'Compte et sécurité', Notifications: 'Notifications', 'Calendar & integrations': 'Calendrier et intégrations',
  Preferences: 'Préférences', Theme: 'Thème', Language: 'Langue', Timezone: 'Fuseau horaire', 'Date format': 'Format de date', 'Sign in': 'Connexion', Password: 'Mot de passe', 'Forgot password?': 'Mot de passe oublié ?', 'Keep me signed in': 'Rester connecté',
  'Stage': 'Étape', 'Project manager': 'Chef de projet', 'Planned date': 'Date prévue', Tags: 'Étiquettes', Customer: 'Client', Reporting: 'Rapports', Configuration: 'Configuration', 'Risk & Issue Register': 'Registre des risques',
  'Send message': 'Envoyer un message', 'Log note': 'Note interne', Activities: 'Activités', Follow: 'Suivre', Following: 'Suivi', Goals: 'Objectifs', Batches: 'Lots', 'Print payslip': 'Imprimer la fiche', 'Net pay': 'Salaire net', Earnings: 'Gains', Deductions: 'Déductions',
}

const TABLES = { fr: FR }
let table = null
let observer = null
const seen = new WeakMap()

function translateNode(node) {
  const text = node.nodeValue
  const key = text.trim()
  if (!key) return
  const hit = table[key]
  if (hit && text !== hit) {
    seen.set(node, key)
    node.nodeValue = text.replace(key, hit)
  }
}

function walk(root) {
  if (root.nodeType === Node.TEXT_NODE) { translateNode(root); return }
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = it.nextNode(); n; n = it.nextNode()) translateNode(n)
}

export function applyLanguage(lang) {
  const next = TABLES[lang] || null
  document.documentElement.lang = lang
  if (next === table) return
  observer?.disconnect()
  observer = null
  const hadTable = Boolean(table)
  table = next
  if (table) {
    observer = new MutationObserver((list) => list.forEach((m) => {
      if (m.type === 'characterData') translateNode(m.target)
      m.addedNodes.forEach(walk)
    }))
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    walk(document.body)
  } else if (hadTable) window.location.reload()
}
