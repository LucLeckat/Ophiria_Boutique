# Documentation technique — Site de commandes de la boutique

Dernière mise à jour : 24 novembre 2026 (identité visuelle Ophiria : logo, couronne, noir/blanc/or ; ajouts « avant lancement » : libération du stock, limites anti-abus, ID en double, commandes par pages, exports, aperçu WhatsApp). Ce document décrit le site tel qu'il est livré : architecture, base de données, sécurité, fonctionnement du code, déploiement, maintenance et dépannage. Les limites connues et les améliorations prévues sont dans le document « Améliorations et limites du site de commandes ».

## 1. Vue d'ensemble

Site de prise de commande pour une boutique vendue via WhatsApp (Cameroun, FCFA, paiement par Mobile Money avec capture d'écran comme preuve).

| Élément | Choix |
| --- | --- |
| Pages | Deux pages HTML statiques, sans framework ni étape de compilation : `index.html` (boutique) et `gestion.html` (espace gérante) |
| Base de données | Supabase (PostgreSQL), plan gratuit |
| Authentification | Supabase Auth, e-mail + mot de passe (gérante uniquement, inscriptions publiques désactivées) |
| Fichiers | Supabase Storage : bucket `products` (public) et bucket `proofs` (privé) |
| Hébergement | Cloudflare Pages, envoi direct de fichiers (pas de dépôt Git) |
| Bibliothèque client | `@supabase/supabase-js` 2.118.0, fichier UMD copié dans `vendor/supabase.js` (pas de CDN, pas de build) |
| Temps réel | Abonnement Supabase Realtime sur les INSERT de la table `orders` (espace Gestion) |

Principe de sécurité : la clé « publishable » est publique par conception. Toute la protection repose sur les règles d'accès PostgreSQL (Row Level Security) et sur deux fonctions SQL `security definer`. Aucune clé secrète n'est dans le code.

## 2. Structure des fichiers

```
boutique/
├── index.html              Boutique (catalogue, panier, paiement)
├── gestion.html            Espace Gestion (commandes, articles, réglages)
├── shared.js               Outils communs : client Supabase, formats, compression d'image, toasts
├── config.js               URL du projet Supabase + clé publishable + interrupteur PREVIEW_LINKS
├── _worker.js              Aperçu des liens WhatsApp (adresses /a/<id>), voir section 5 bis
├── _routes.json            Limite _worker.js aux adresses /a/*
├── style.css               Styles communs, thème clair/sombre automatique
├── logo.jpg                Logo Ophiria Boutique (en-tête de la boutique et de la Gestion)
├── favicon.svg, favicon.png, apple-touch-icon.png   Icône couronne dorée sur fond noir
├── robots.txt              Interdit l'indexation de /gestion
├── _headers                En-têtes Cloudflare (nosniff, referrer, noindex sur /gestion)
├── vendor/supabase.js      supabase-js 2.118.0 (UMD)
└── supabase/
    ├── 1_schema.sql        Tables, règles d'accès, fonctions, stockage (relançable sans perte)
    └── 2_ajouter_gerante.sql   Ajoute l'e-mail de la gérante dans la table admins
```

Le dossier `supabase/` n'est pas publié sur Cloudflare : le zip du site contient seulement les fichiers de la racine et `vendor/`. `_worker.js` et `_routes.json` sont dans un paquet séparé et facultatif (`apercu-whatsapp-optionnel.zip`) : à ajouter à la racine du site seulement pour tester l'aperçu WhatsApp.

Ordre de chargement dans chaque page : `vendor/supabase.js`, `config.js`, `shared.js`, puis le script de la page. `shared.js` expose un objet global `window.B` (`sb`, `esc`, `money`, `setCurrency`, `uuid`, `shrink`, `toast`, `publicUrl`, `sizesOf`, `hasSizes`, `totalStock`).

## 3. Configuration

`config.js` contient trois valeurs : `SUPABASE_URL`, `SUPABASE_KEY` (clé `sb_publishable_…`) et `PREVIEW_LINKS` (`false` par défaut, voir section 5 bis). Pour changer de projet Supabase, modifier ce fichier et redéployer.

Identité visuelle : couleurs du logo définies en haut de `style.css` (noir `#141414`, or `#b8923a`, texte or `#7a5c14` ; en mode sombre, fond noir et or clair `#d4b25c`). Le logo s'affiche sur une plaque blanche pour rester lisible en mode sombre. Le nom affiché dans l'onglet du navigateur et dans l'aperçu WhatsApp vient du réglage « Nom de la boutique » : le mettre à `Ophiria Boutique`.

Les réglages de la boutique (nom, devise, numéro Mobile Money, titulaire, opérateurs, numéro WhatsApp, liste des groupes) sont dans la table `settings` et se modifient depuis l'onglet Réglages. Ils ne sont pas dans le code.

## 4. Base de données

Schéma `public`. Les noms de colonnes sont en anglais, les valeurs de statut en français avec accents.

### Tables

| Table | Rôle | Colonnes principales |
| --- | --- | --- |
| `admins` | Liste des e-mails autorisés dans la Gestion | `email` (clé primaire) |
| `settings` | Réglages, une seule ligne (`id = 1`) | `shop_name`, `currency`, `momo_number`, `momo_name`, `momo_ops`, `whatsapp`, `groups` (texte séparé par des virgules), `hold_hours` (0 à 72, défaut 6 : délai avant libération du stock d'une commande non payée, 0 = jamais) |
| `products` | Un article | `id` (uuid), `name`, `category`, `price` (entier, FCFA), `image_path`, `thumb_path`, `video_url`, `active`, `created_at` |
| `product_sizes` | Stock par taille | `product_id`, `size`, `stock` (≥ 0), `sort`. Unicité `(product_id, size)`. Un article sans taille a une seule ligne `size = 'unique'` |
| `orders` | Une commande | `id`, `order_no` (séquence, affiché `CMD-0001`), `created_at`, `customer_name`, `phone`, `wa_group`, `city`, `delivery`, `note`, `txn_ref`, `proof_path`, `total`, `status`, et depuis les ajouts : `phone_key` (9 derniers chiffres du téléphone), `ip_hash` (empreinte md5 de l'adresse IP, jamais l'IP), `ref_dup` (ID de transaction déjà utilisé), `hold_from` (début du délai si la commande a été remise en attente) |
| `order_items` | Lignes d'une commande | `order_id`, `product_id` (mis à NULL si l'article est supprimé), `product_name`, `size`, `qty`, `unit_price` |

Choix de conception :
- Le nom et le prix de l'article sont recopiés dans `order_items` : modifier ou supprimer un article ne change pas l'historique.
- Statuts autorisés (contrainte CHECK `orders_status_check`) : `à vérifier`, `payée`, `préparée`, `expédiée`, `livrée`, `annulée`, `expirée`.
- Un article sans taille utilise la taille `unique` pour que le stock se gère toujours de la même façon.
- `order_no` vient de la séquence `order_no_seq` : les numéros ne sont pas réutilisés, des trous sont possibles si une commande échoue après l'attribution du numéro (la transaction est annulée, la séquence avance quand même).

### Fonctions SQL

| Fonction | Appelable par | Rôle |
| --- | --- | --- |
| `is_admin()` | anon, authenticated | Vrai si l'e-mail du jeton JWT (insensible à la casse) est dans `admins`. Utilisée par toutes les règles d'accès |
| `place_order(...)` | anon, authenticated | Crée une commande. Voir ci-dessous |
| `set_order_status(p_id, p_status)` | authenticated, et vérifie `is_admin()` | Change le statut. Annuler remet le stock en rayon |
| `release_expired_orders()` | anon, authenticated | Passe en `expirée` les commandes `à vérifier` plus anciennes que `hold_hours` et remet leur stock en rayon. Retourne le nombre de commandes libérées |
| `reinstate_order(p_id)` | authenticated, et vérifie `is_admin()` | Remet une commande `expirée` en `à vérifier` en reprenant le stock, ou refuse (`STOCK:…`) s'il n'y en a plus |
| `forget_proofs(p_ids uuid[])` | authenticated, et vérifie `is_admin()` | Met `proof_path` à NULL après suppression des fichiers de captures |

#### `place_order`

Paramètres : `p_name`, `p_phone`, `p_group`, `p_city`, `p_delivery`, `p_note`, `p_ref`, `p_proof`, `p_items` (jsonb : tableau de `{product_id, size, qty, name}`). Retourne une ligne `(o_id, o_no, o_total)`.

Déroulé, dans une seule transaction :
1. Validation : nom et ville non vides, téléphone d'au moins 8 chiffres, longueurs maximales, panier de 1 à 30 lignes.
1 bis. Libération des commandes expirées (`release_expired_orders()`), pour que le stock vu soit le vrai.
1 ter. Limites anti-abus (valeurs écrites dans la fonction, modifiables en relançant le SQL) : 5 commandes par heure et par téléphone (`LIMIT:phone`), 3 commandes en attente par téléphone (`LIMIT:pending`), 60 commandes par heure et par adresse IP (`LIMIT:ip`). L'IP est lue dans l'en-tête `cf-connecting-ip`, à défaut le premier `x-forwarded-for`, transmis par Supabase dans `request.headers` ; si l'en-tête manque la limite IP est ignorée. La limite IP est large parce que plusieurs clients d'un même opérateur mobile peuvent partager une adresse.
2. La capture doit avoir un nom de la forme `<uuid>.jpg` et exister déjà dans `storage.objects` (bucket `proofs`). Sinon erreur `INVALID:preuve`.
3. Insertion de la commande avec un total à 0.
4. Pour chaque ligne, triée par `product_id` puis `size` (évite les blocages croisés) : lecture de l'article actif et de la taille avec `FOR UPDATE`, quantité de 1 à 50, contrôle du stock, décrément, insertion de la ligne avec le prix lu dans la base.
5. Mise à jour du total.
6. Si l'ID de transaction (au moins 4 caractères, espaces et casse ignorés) existe déjà sur une autre commande qui n'est ni `annulée` ni `expirée`, les deux commandes reçoivent `ref_dup = true`.

Le prix, le nom et le total viennent toujours de la base : le navigateur ne peut pas les imposer. Toute erreur annule l'ensemble (commande et décréments).

Messages d'erreur renvoyés par `place_order` :

| Message | Cause | Traitement côté boutique |
| --- | --- | --- |
| `INVALID:coordonnees` | Nom, ville, téléphone ou longueur invalide | « Vérifiez vos coordonnées » |
| `INVALID:preuve` | Capture absente ou nom invalide | Demande de renvoyer la capture |
| `INVALID:panier`, `INVALID:quantite` | Panier ou quantité hors limites | Message générique |
| `UNAVAILABLE:<nom>` | Article masqué, supprimé ou taille inexistante | Recharge le catalogue, ajuste le panier |
| `STOCK:<nom>\|<taille>\|<stock restant>` | Stock insuffisant | Recharge le catalogue, ajuste le panier, message avec la quantité restante |
| `LIMIT:phone`, `LIMIT:pending`, `LIMIT:ip` | Trop de commandes (voir 1 ter) | Message clair, invitation à attendre ou à écrire sur WhatsApp |

#### `set_order_status`

- Réservée aux admins (`FORBIDDEN` sinon).
- Statuts acceptés : `payée`, `préparée`, `expédiée`, `livrée`, `annulée` (on ne revient jamais à `à vérifier`, sauf par `reinstate_order` depuis `expirée`).
- Une commande `expirée` (stock déjà rendu) ne peut qu'être annulée, sans second retour en stock (`INVALID:expiree` pour tout autre statut), ou remise en attente par `reinstate_order`.
- Une commande `annulée` ne peut plus changer (`INVALID:annulee-definitive`).
- Passer à `annulée` ajoute les quantités des lignes au stock des tailles correspondantes. Les lignes dont l'article a été supprimé (`product_id` NULL) ou dont la taille n'existe plus sont ignorées.

### Règles d'accès (Row Level Security)

RLS est activé sur toutes les tables. Les droits sont d'abord retirés (`revoke all`) puis redonnés au minimum.

| Table | Visiteur (anon) | Gérante (authenticated + `is_admin()`) | Autre compte connecté |
| --- | --- | --- | --- |
| `settings` | Lecture | Lecture, modification | Lecture |
| `products` | Lecture des articles actifs | Tout | Lecture des articles actifs |
| `product_sizes` | Lecture des tailles d'articles actifs | Tout | Lecture des articles actifs |
| `orders`, `order_items` | Aucun accès direct | Lecture | Aucun accès |
| `admins` | Aucun accès | Aucun accès direct (lue seulement par `is_admin()`) | Aucun accès |

Il n'existe aucune règle d'écriture sur `orders` et `order_items` : les commandes se créent par `place_order` et se modifient par `set_order_status`.

### Stockage

| Bucket | Public | Limite | Types | Droits |
| --- | --- | --- | --- | --- |
| `products` | Oui (lecture par URL publique) | 2 Mo | jpeg, png, webp | Écriture, mise à jour et suppression : gérante |
| `proofs` | Non | 3 Mo | jpeg | Dépôt : tout le monde. Lecture et suppression : gérante (URL signée de 10 minutes) |

Conventions de noms et compression (faite dans le navigateur, via un canvas) :

| Fichier | Nom | Taille |
| --- | --- | --- |
| Photo d'article | `<id-article>-<horodatage>.jpg` | 900 px, qualité 0,72 |
| Miniature | `<id-article>-<horodatage>-t.jpg` | 420 px, qualité 0,7 |
| Capture de paiement | `<uuid>.jpg` | 1000 px, qualité 0,6 |

Le nom change à chaque remplacement de photo pour éviter les caches périmés ; les anciens fichiers sont supprimés.

### Temps réel

`orders` est ajoutée à la publication `supabase_realtime`. La Gestion écoute les INSERT (canal `orders-live`), joue un son et recharge la liste. Les évènements respectent RLS : seule une gérante les reçoit.

## 5. Page boutique (`index.html`)

- Au chargement, la boutique appelle `release_expired_orders()` au plus une fois toutes les 2 minutes par visiteur, puis charge les données. Il n'y a pas de tâche planifiée : le stock est libéré dès qu'un visiteur ou la gérante ouvre le site, ou qu'une commande arrive.
- Chargement : un appel pour `settings`, un pour les articles actifs avec leurs tailles (`product_sizes(size,stock,sort)`), limité à 1 000 articles. Affichage par pages de 24 (bouton « Voir plus »), filtre par catégorie, recherche par nom côté navigateur.
- Panier : stocké dans `localStorage` (`boutique-panier-v1`), clé `<id>|<taille>` → quantité. Ajusté au stock réel à chaque chargement et à l'ouverture du panier.
- Lien direct : `adresse/#a-<id-article>` affiche l'article seul, avec un bandeau « Voir tous les articles ». Le bouton « Copier le lien » le génère ; avec `PREVIEW_LINKS: true` il copie `adresse/a/<id-article>` (aperçu WhatsApp).
- Parcours en quatre étapes dans un tiroir : panier, coordonnées, paiement (montant exact, numéro Mobile Money, capture obligatoire), confirmation avec bouton WhatsApp facultatif.
- Envoi : la capture est d'abord envoyée dans `proofs` (nom aléatoire), puis `place_order` est appelée. Si l'envoi de la commande échoue pour un problème de stock, la capture déjà envoyée est conservée pour la nouvelle tentative (`ui.proofPath`). Le bouton est désactivé pendant l'envoi pour éviter les doubles commandes.
- Aucun prix n'est envoyé au serveur : seulement `product_id`, `size`, `qty`.

## 5 bis. Aperçu des liens WhatsApp (`_worker.js`)

`/a/<id>` est traité par `_worker.js` (mode « advanced » de Cloudflare Pages) : il lit l'article et le nom de la boutique par l'API REST de Supabase avec la clé publishable (lue dans `config.js`), puis renvoie une petite page avec les balises Open Graph (`og:title` = nom, `og:description` = prix · boutique, `og:image` = photo 900 px). WhatsApp affiche alors la photo, le nom et le prix. Un visiteur est redirigé aussitôt vers `/#a-<id>`. Si l'article n'existe pas ou est masqué, ou en cas d'erreur, redirection vers la boutique. `_routes.json` limite le worker aux adresses `/a/*` : le reste du site reste servi comme fichiers statiques.

État : la logique du worker est testée localement (échappement HTML, article inconnu, autres adresses transmises aux fichiers). Le comportement réel sur Cloudflare Pages avec l'envoi direct par le tableau de bord n'est **pas vérifié** : c'est pourquoi `PREVIEW_LINKS` vaut `false`. Pour l'activer : redéployer, ouvrir `https://adresse/a/<id d'un article>` (doit afficher puis rediriger), tester le lien dans une conversation WhatsApp, puis passer `PREVIEW_LINKS` à `true` et redéployer. Si l'envoi direct ne prend pas en compte `_worker.js`, laisser `false` : le site fonctionne comme avant. WhatsApp garde en cache l'aperçu d'un lien déjà partagé.

## 6. Page gestion (`gestion.html`)

- Connexion : `signInWithPassword`, puis appel `is_admin()`. Si le compte n'est pas dans `admins`, déconnexion immédiate avec un message.
- Commandes : chargées par pages de 40 directement depuis la base (`range`), avec leurs lignes, tri par date puis numéro décroissants. Les filtres (statut, dates « du … au … », recherche par nom, téléphone, numéro `CMD-0012` ou ID de transaction) sont appliqués par la base, pas par le navigateur : le nombre total de commandes du filtre est affiché, « Voir plus » charge les 40 suivantes. Cliquer sur un ID de transaction lance la recherche de cet ID. Actualisation toutes les 60 secondes (page visible, onglet Commandes) et à chaque évènement temps réel : seules les lignes déjà affichées sont rechargées, après un appel à `release_expired_orders()`.
- Chiffres du haut : requêtes de comptage (à vérifier, à préparer, commandes du jour) et somme des commandes payées du jour (1 000 lignes au plus), avec le fuseau horaire de l'appareil. Aucune liste complète n'est chargée.
- Commandes `à vérifier` : le temps de stock encore réservé est affiché. Commandes `expirées` : bouton « Remettre en attente » (`reinstate_order`), qui échoue avec le stock restant s'il n'y en a plus. Une commande dont l'ID de transaction est déjà utilisé affiche une alerte rouge, sur les deux commandes concernées.
- Preuve de paiement : URL signée de 10 minutes demandée au clic, mise en cache pendant la session.
- Actions : « Valider le paiement » (`payée`), liste déroulante des autres statuts, « Refuser » ou « Annuler » avec confirmation en deux clics, toutes via `set_order_status`.
- Exports CSV (séparateur point-virgule, BOM UTF-8, ouverture directe dans Excel) : « Exporter cette liste » (respecte statut, dates et recherche), « Toutes les commandes », « Articles et stocks » (une ligne par taille), « Tout sauvegarder » (les deux). Les commandes sont lues par lots de 1 000, triées par numéro. Les textes qui commencent par `=`, `+`, `-` ou `@` (hors numéros de téléphone) sont précédés d'une apostrophe pour éviter l'exécution de formules par Excel. Un bandeau de rappel s'affiche dans l'onglet Commandes si aucune sauvegarde complète n'a été faite depuis 7 jours (date mémorisée dans le navigateur, clé `boutique-dernier-export` : elle est propre à chaque appareil).
- Articles : ajout et modification (nom, catégorie, prix, tailles `S:2, M:3`, photo, vidéo, visibilité), stock par taille modifiable en ligne, masquer ou afficher, supprimer. La synchronisation des tailles fait un `upsert` sur `(product_id, size)` puis supprime les tailles retirées.
- Réglages : mise à jour de la ligne `settings`, dont le délai de libération du stock (`hold_hours`). Panneau « Sauvegardes ». Bouton « Libérer de la place » : supprime les captures des commandes livrées, annulées ou expirées de plus de 30 jours (500 à la fois), puis appelle `forget_proofs`.
- Photos d'articles : envoyées avec `cacheControl` d'un an (le nom change à chaque remplacement), ce qui réduit le trafic sortant de Supabase.
- Préférences locales : son activé ou non (`boutique-son`). Le son demande un premier clic sur la page (règle des navigateurs).

## 7. Déploiement

Première mise en ligne (détaillée dans le document « Fonctionnement du site de commandes ») :
1. Supabase, SQL Editor : exécuter `1_schema.sql`.
2. Authentication, Users : créer le compte de la gérante. Désactiver les inscriptions publiques.
3. Exécuter `2_ajouter_gerante.sql` avec son e-mail.
4. Cloudflare Pages : projet en envoi direct de fichiers, déposer le contenu du dossier du site (sans le dossier `supabase/`).

Mise à jour du site : modifier les fichiers, puis créer un nouveau déploiement dans le projet Cloudflare Pages en redéposant le dossier. Le menu exact peut varier (bouton de création de déploiement dans l'onglet Deployments).

Mise à jour du schéma : `1_schema.sql` se relance sans perte de données (`create … if not exists`, `add column if not exists`, `create or replace`, `drop policy if exists`). Les nouvelles fonctions ou colonnes s'ajoutent dans ce fichier, puis on le relance. **Ordre à respecter pour une mise à jour : d'abord le SQL, ensuite les fichiers du site** (la nouvelle Gestion utilise des colonnes et fonctions qui n'existent qu'après le SQL).

Photos déjà envoyées avant cette mise à jour : elles gardent l'ancien délai de cache ; seules les nouvelles photos ont le cache d'un an.

## 8. Maintenance

Ajouter une personne à la Gestion : créer son compte dans Authentication, Users, puis dans SQL Editor :

```sql
insert into public.admins (email) values ('personne@exemple.com') on conflict do nothing;
```

Retirer l'accès : `delete from public.admins where lower(email) = lower('personne@exemple.com');` (pensez aussi à supprimer le compte dans Authentication).

Mot de passe oublié : Authentication, Users, choisir le compte puis réinitialiser le mot de passe.

Corriger un stock à la main :

```sql
update public.product_sizes set stock = 5
where size = 'M' and product_id = (select id from public.products where name = 'Robe fleurie');
```

Surveiller la consommation (pendant la première semaine de lancement, puis une fois par semaine) : tableau de bord Supabase, rubrique Usage de l'organisation (menu de l'organisation, pas du projet). Relever chaque jour : trafic sortant (egress), taille de la base, stockage de fichiers, utilisateurs actifs. Comparer aux limites du plan affichées sur la même page (les chiffres du plan peuvent changer : se fier à la page). Passer au plan Pro (à partir de 25 $ par mois à la date de rédaction) si une de ces jauges dépasse environ 70 % de sa limite avant la fin de la période, ou si le projet est mis en pause. Le plan gratuit met en pause un projet inactif : le plan Pro évite aussi cela. Ces vérifications sont manuelles : le site ne les mesure pas.

Sauvegardes : le site propose des exports CSV (Réglages, Sauvegardes) et rappelle une sauvegarde hebdomadaire. Les captures de paiement ne sont pas incluses dans les exports.

Réglages anti-abus : les seuils (5 commandes par heure, 3 en attente, 60 par IP) sont dans `place_order`. Pour les changer, modifier les nombres dans `1_schema.sql` et le relancer. Cloudflare Turnstile (anti-robot) n'est pas installé : il demande une vérification côté serveur avec une clé secrète, ce que l'architecture actuelle sans serveur ne permet pas sans fonction supplémentaire. À envisager si des robots apparaissent malgré les limites.

Projet en pause : le plan gratuit met le projet en pause après 7 jours sans activité. Le site affiche alors « Impossible de charger la boutique ». Restaurer le projet depuis le tableau de bord Supabase.

## 9. Dépannage

| Symptôme | Cause probable | Action |
| --- | --- | --- |
| « Impossible de charger la boutique » | Projet Supabase en pause ou réseau coupé | Restaurer le projet, vérifier `config.js` |
| Connexion refusée à la Gestion avec le bon mot de passe | E-mail absent de `admins` ou différent | Vérifier l'orthographe dans `admins` |
| « Ce compte n'a pas accès » | Compte créé mais non ajouté à `admins` | Exécuter `2_ajouter_gerante.sql` |
| `INVALID:preuve` à la commande | La capture n'a pas été envoyée ou a été refusée (plus de 3 Mo ou autre format) | Choisir à nouveau la capture |
| Les photos ne s'affichent pas | Bucket `products` non public ou fichier supprimé | Relancer `1_schema.sql`, vérifier le bucket |
| Pas de son à une nouvelle commande | Page non cliquée depuis son ouverture, son désactivé, ou Realtime indisponible | Cliquer sur la page, vérifier la case, attendre l'actualisation de 60 s |
| Modification refusée (permission denied) | Session expirée ou compte non admin | Se reconnecter |
| La Gestion affiche « Chargement impossible » ou une erreur après la mise à jour | Le SQL n'a pas été relancé avant le nouveau site | Relancer `1_schema.sql` |
| Un client dit qu'on lui refuse sa commande (« plusieurs commandes ») | Limite anti-abus atteinte (téléphone, commandes en attente ou IP) | Valider ou refuser ses commandes en attente, ou attendre une heure |
| Des commandes passent en « expirée » | Délai `hold_hours` dépassé sans paiement validé | Remettre en attente si le client a payé, ou allonger le délai dans Réglages |
| Le lien `/a/…` ne montre pas l'aperçu | `_worker.js` non pris en compte par l'envoi direct, ou aperçu déjà en cache dans WhatsApp | Laisser `PREVIEW_LINKS` à `false` ; tester avec un autre article |

## 10. Vérifications effectuées

| Élément | Comment | Résultat |
| --- | --- | --- |
| Schéma SQL, fonctions, règles d'accès | Exécution sur PostgreSQL 16 local avec des modules `auth` et `storage` simulés : commande valide, commande sans preuve, stock insuffisant (rien n'est modifié), annulation qui remet le stock, annulation non réversible, droits du visiteur, de la gérante et d'un autre compte | Conforme |
| Pages boutique et Gestion | Navigateur automatisé (Playwright) contre une API Supabase simulée : commande complète, paiement avec capture, validation, annulation, ajout et modification d'articles, export CSV, réglages, absence de défilement horizontal à 400 px | Conforme |
| Site en ligne (Supabase réel + Cloudflare) | Test manuel de la propriétaire du projet, le 18 novembre 2026 | Fonctionnement confirmé, sans détail des scénarios |
| Ajouts « avant lancement » : SQL | PostgreSQL 16 local : limites par téléphone (5 par heure, 3 en attente), limite IP, absence d'en-tête ou en-tête invalide, ID en double (casse et espaces ignorés), stock insuffisant sans effet, expiration après le délai, pas de seconde libération, délai 0 = désactivé, remise en attente avec et sans stock, annulation d'une commande expirée sans second retour en stock, droits du visiteur et d'un compte non admin, relance du schéma | Conforme |
| Ajouts « avant lancement » : pages | Navigateur automatisé contre une API simulée (étendue : comptages, plages, recherche, dates) : 94 commandes en pages de 40, « Voir plus », filtres statut, date, numéro, nom, ID, alertes d'ID en double, expiration et remise en attente avec stock, exports complets (lots) et articles, rappel de sauvegarde, délai dans Réglages, message de limite côté boutique | Conforme |
| Ajouts « avant lancement » : aperçu WhatsApp | Exécution de `_worker.js` sous Node avec Supabase et fichiers simulés | Logique conforme ; comportement réel sur Cloudflare Pages non vérifié |
| Non vérifié | Syntaxe exacte des filtres `or(...ilike...)` envoyés à l'API Supabase réelle, lecture des en-têtes IP dans `request.headers`, `_worker.js` en envoi direct, commandes simultanées en charge réelle, appareils d'entrée de gamme, réseau faible, Realtime en production, limites réelles du plan gratuit | À couvrir par la liste de tests du document « Améliorations et limites » |

Le SQL a été validé sur un PostgreSQL local, pas sur Supabase directement : les modules `auth` et `storage` simulés reproduisent seulement ce dont le schéma a besoin.
