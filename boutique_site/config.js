// Connexion au projet Supabase. La cle "publishable" est faite pour etre visible dans le site :
// ce sont les regles d'acces de la base (schema SQL) qui protegent les donnees.
window.BOUTIQUE_CONFIG = {
  SUPABASE_URL: 'https://gozjppnsggptunuieqhd.supabase.co',
  SUPABASE_KEY: 'sb_publishable_Du30P7TEJLZp0539klqoqA_zeOuOthN',
  // Passez a true seulement apres avoir verifie que https://VOTRE-SITE/a/<id d'un article> affiche bien la page d'apercu
  // (necessite le fichier _worker.js et _routes.json deployes avec le site).
  PREVIEW_LINKS: false
};
