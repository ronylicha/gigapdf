/**
 * Données SEO programmatique — pages outils (/tools/[slug]).
 *
 * Contenu statique rédigé en français (langue canonique du domaine).
 * Chaque entrée décrit UNIQUEMENT des capacités réellement présentes dans
 * GigaPDF — moteur PDF maison (TypeScript/WebAssembly).
 * Aucun gabarit à variables : intros et FAQ rédigées individuellement.
 */

export interface ToolFaqItem {
  question: string;
  answer: string;
}

export interface ToolHowTo {
  title: string;
  steps: string[];
}

/** Famille fonctionnelle d'un outil, pour le regroupement (mégamenu, filtres). */
export type ToolCategory = "organize" | "convert" | "edit" | "secure" | "ocr";

export interface ToolData {
  slug: string;
  name: string;
  /** Famille fonctionnelle pour le regroupement dans le mégamenu */
  category: ToolCategory;
  /** ≤ 60 caractères */
  metaTitle: string;
  /** ≤ 155 caractères */
  metaDescription: string;
  h1: string;
  /** 2-3 paragraphes rédigés */
  intro: string[];
  howTo: ToolHowTo;
  capabilities: string[];
  faq: ToolFaqItem[];
  useCases: string[];
  relatedTools: string[];
  relatedSolutions: string[];
  /** Nom d'icône lucide (mappé dans components/seo/tool-icon.tsx) */
  icon: string;
  /**
   * Lien interne optionnel vers l'outil fonctionnel correspondant dans l'app
   * (ex: "/merge"). Si présent, la page outil affiche un CTA direct vers l'outil.
   */
  appHref?: string;
}

export const TOOLS: ToolData[] = [
  {
    slug: "editer-pdf",
    appHref: "/documents",
    name: "Éditer un PDF",
    category: "edit",
    metaTitle: "Éditer un PDF en ligne gratuitement | GigaPDF",
    metaDescription:
      "Modifiez texte, images et formes directement dans vos PDF, avec les polices d'origine. Éditeur WYSIWYG gratuit, open source et auto-hébergeable.",
    h1: "Éditeur PDF en ligne : modifiez le texte, les images et les formes directement dans le fichier",
    intro: [
      "Corriger une faute dans un contrat déjà exporté, mettre à jour un tarif sur une plaquette, remplacer un logo : la plupart des outils en ligne se contentent de poser un cadre blanc par-dessus l'ancien contenu. GigaPDF travaille autrement. Son éditeur WYSIWYG ouvre la page telle qu'elle s'imprimera et vous laisse cliquer sur un bloc de texte, une image ou une forme pour le modifier, le déplacer ou le supprimer réellement.",
      "La fidélité typographique fait la différence : GigaPDF identifie les polices utilisées dans le document, les télécharge automatiquement depuis Google Fonts quand elles y sont disponibles, puis les embarque dans le fichier au moment de l'enregistrement. Votre correction reprend la même police que le paragraphe d'origine, sans substitution Arial disgracieuse. Pour les suppressions, le moteur maison retire les opérateurs de texte du flux de contenu au lieu de les masquer — rien ne réapparaît au copier-coller.",
      "L'éditeur fonctionne dans le navigateur, sans installation. Le plan gratuit inclut toutes les fonctions d'édition, avec 5 Go de stockage et 1000 documents. Le code est open source, source-available sous licence PolyForm Noncommercial : les équipes qui manipulent des documents sensibles peuvent héberger l'application sur leur propre serveur.",
    ],
    howTo: {
      title: "Comment modifier un PDF en ligne",
      steps: [
        "Créez un compte gratuit et importez votre PDF par glisser-déposer dans votre espace.",
        "Ouvrez le document dans l'éditeur : chaque bloc de texte, image et forme devient sélectionnable.",
        "Double-cliquez sur un texte pour le corriger ; la police d'origine est chargée automatiquement.",
        "Ajoutez de nouveaux éléments si besoin : zone de texte, image, rectangle, flèche ou trait.",
        "Supprimez les éléments obsolètes : le contenu est retiré du fichier, pas recouvert.",
        "Enregistrez : les polices modifiées sont embarquées et une nouvelle version du document est conservée.",
      ],
    },
    capabilities: [
      "Édition WYSIWYG du texte, des images et des formes existantes",
      "Déplacer, redimensionner, supprimer et dupliquer n'importe quel élément sur place, sans perte",
      "Polices d'origine détectées, téléchargées depuis Google Fonts et embarquées à l'enregistrement",
      "Restyler les formes vectorielles : remplissage, couleur de contour, épaisseur et pointillés",
      "Édition de tableaux : insérer ou supprimer des lignes et des colonnes, fusionner des cellules, régler bordures et fonds",
      "Listes à puces et numérotées, avec niveaux d'indentation et marqueurs",
      "Opacité et transparence des éléments, intégrées dans le PDF",
      "Ordre d'empilement — premier ou arrière-plan, enregistré dans le PDF lui-même",
      "Calques persistants : créer, renommer, verrouiller et masquer, conservés d'une session à l'autre",
      "Suppression réelle du contenu par le moteur maison (pas de masque blanc)",
      "Annotations natives, filigranes et remplissage de formulaires depuis le même éditeur",
      "Historique de versions et miniatures de pages dans la GED intégrée",
      "Collaboration en temps réel sur le même document",
    ],
    faq: [
      {
        question: "Puis-je modifier le texte existant d'un PDF, pas seulement en ajouter ?",
        answer:
          "Oui. GigaPDF extrait les blocs de texte du fichier et les rend éditables en place. Quand vous corrigez un paragraphe, l'ancien contenu est supprimé du flux PDF par le moteur maison et le nouveau texte est écrit avec la police d'origine, embarquée dans le fichier au moment de l'enregistrement.",
      },
      {
        question: "Que se passe-t-il si la police du PDF n'est pas installée sur mon ordinateur ?",
        answer:
          "Vous n'avez rien à installer. GigaPDF reconnaît la police déclarée dans le document et la télécharge automatiquement depuis Google Fonts lorsqu'elle y est référencée. Si une police propriétaire n'est pas disponible, une équivalente proche est proposée et clairement indiquée avant l'enregistrement.",
      },
      {
        question: "L'éditeur PDF de GigaPDF est-il vraiment gratuit ?",
        answer:
          "Oui. Le plan gratuit donne accès à toutes les fonctions, édition comprise, avec 5 Go de stockage, 1000 documents et 1 000 appels API par mois. Il n'existe pas de version bridée de l'éditeur : les limites portent sur le volume, pas sur les fonctionnalités.",
      },
      {
        question: "Mes documents confidentiels sont-ils en sécurité ?",
        answer:
          "Vos fichiers restent dans votre espace personnel, peuvent être chiffrés en AES-256 et sont restaurables depuis la corbeille pendant 30 jours. Pour un contrôle total, GigaPDF est open source et auto-hébergeable : vous pouvez faire tourner l'application entière sur votre propre infrastructure.",
      },
      {
        question: "Peut-on éditer un PDF à plusieurs en même temps ?",
        answer:
          "Oui, l'éditeur prend en charge la collaboration en temps réel. Plusieurs personnes peuvent ouvrir le même document, voir les modifications des autres en direct et travailler sans s'écraser mutuellement, ce qui évite les allers-retours de versions par e-mail.",
      },
    ],
    useCases: [
      "Corriger une coquille ou mettre à jour une date dans un contrat sans repasser par le fichier Word d'origine",
      "Remplacer un logo, un tarif ou une mention légale sur une plaquette commerciale déjà au format PDF",
      "Nettoyer un document reçu d'un tiers : retirer des éléments obsolètes et ajouter les informations manquantes",
    ],
    relatedTools: ["annoter-pdf", "organiser-pages-pdf", "filigrane-pdf", "formulaires-pdf"],
    relatedSolutions: ["freelances", "ressources-humaines", "avocats"],
    icon: "pen-line",
  },
  {
    slug: "fusionner-pdf",
    name: "Fusionner des PDF",
    category: "organize",
    appHref: "/merge",
    metaTitle: "Fusionner des PDF en ligne gratuitement | GigaPDF",
    metaDescription:
      "Combinez plusieurs PDF en un seul fichier, dans l'ordre de votre choix. Outil gratuit, sans filigrane ajouté, open source et auto-hébergeable.",
    h1: "Fusionner plusieurs PDF en un seul document",
    intro: [
      "Un dossier de candidature, une liasse de pièces justificatives, un rapport assemblé depuis plusieurs services : ces documents finissent toujours éparpillés en cinq ou six fichiers PDF distincts. Les envoyer tels quels oblige le destinataire à jongler entre les pièces jointes ; les imprimer pour les rescanner dégrade la qualité. La fusion produit un fichier unique, paginé en continu, prêt à être transmis ou archivé.",
      "GigaPDF assemble vos PDF côté serveur avec son moteur dédié : les pages sont copiées sans recompression, les signets et les champs de formulaire des fichiers sources sont préservés autant que le format le permet, et aucun filigrane publicitaire n'est apposé sur le résultat. Vous réordonnez les fichiers avant la fusion, puis les pages elles-mêmes dans l'éditeur si un ajustement s'impose.",
      "L'outil s'intègre à la GED de GigaPDF : le fichier fusionné rejoint vos dossiers, peut être tagué, recherché en texte intégral et partagé par lien ou par e-mail. Le tout est inclus dans le plan gratuit, et l'application complète peut être auto-hébergée puisque le code est « source-available » sous licence PolyForm Noncommercial.",
    ],
    howTo: {
      title: "Comment fusionner des fichiers PDF",
      steps: [
        "Importez les PDF à combiner dans votre espace GigaPDF, en une seule sélection ou par lots.",
        "Sélectionnez les documents puis lancez la fusion depuis le menu d'actions.",
        "Glissez-déposez les fichiers pour définir l'ordre d'assemblage final.",
        "Validez : le moteur copie les pages sans recompression et génère le document combiné.",
        "Ajustez si besoin l'ordre des pages dans l'éditeur, puis partagez ou archivez le fichier fusionné.",
      ],
    },
    capabilities: [
      "Fusion d'un nombre illimité de fichiers en un seul PDF",
      "Réorganisation de l'ordre des documents avant assemblage",
      "Copie des pages sans recompression ni perte de qualité",
      "Aucun filigrane ajouté sur le fichier produit",
      "Réorganisation fine des pages après fusion dans l'éditeur",
      "Classement du résultat dans la GED : dossiers, tags, recherche plein texte",
    ],
    faq: [
      {
        question: "Combien de fichiers PDF puis-je fusionner à la fois ?",
        answer:
          "GigaPDF ne fixe pas de plafond sur le nombre de fichiers d'une fusion. La seule limite est celle de votre espace de stockage : le plan gratuit offre 5 Go et 1000 documents, ce qui couvre largement des liasses de plusieurs centaines de pages.",
      },
      {
        question: "La fusion dégrade-t-elle la qualité des documents ?",
        answer:
          "Non. Les pages sont copiées telles quelles dans le fichier final, sans réencodage des images ni réinterprétation du contenu. Un PDF vectoriel reste vectoriel, un scan conserve sa résolution d'origine. Si vous voulez réduire le poids du résultat, l'outil de compression s'applique ensuite, en option.",
      },
      {
        question: "Puis-je changer l'ordre des pages après la fusion ?",
        answer:
          "Oui. Le document fusionné s'ouvre dans l'éditeur GigaPDF, où la vue en miniatures permet de déplacer, faire pivoter, supprimer ou extraire n'importe quelle page. Vous n'avez pas besoin de recommencer la fusion pour corriger un ordre imparfait.",
      },
      {
        question: "Les formulaires et les liens des fichiers d'origine sont-ils conservés ?",
        answer:
          "Les champs de formulaire et les liens internes des documents sources sont repris dans le fichier fusionné dans la mesure où la structure PDF le permet. Si deux formulaires utilisent des noms de champs identiques, GigaPDF les distingue pour éviter qu'une saisie n'écrase l'autre.",
      },
    ],
    useCases: [
      "Assembler un dossier de location ou de prêt : pièce d'identité, justificatifs, avis d'imposition en un seul fichier",
      "Regrouper les factures d'un mois en une liasse unique avant transmission au cabinet comptable",
      "Construire un rapport final à partir des chapitres PDF produits par plusieurs contributeurs",
    ],
    relatedTools: ["diviser-pdf", "organiser-pages-pdf", "compresser-pdf"],
    relatedSolutions: ["experts-comptables", "immobilier", "associations"],
    icon: "merge",
  },
  {
    slug: "diviser-pdf",
    name: "Diviser un PDF",
    category: "organize",
    appHref: "/split",
    metaTitle: "Diviser un PDF : extraire des pages en ligne | GigaPDF",
    metaDescription:
      "Découpez un PDF en plusieurs fichiers ou extrayez les pages utiles. Sélection visuelle par miniatures, gratuit et open source.",
    h1: "Diviser un PDF et extraire les pages dont vous avez besoin",
    intro: [
      "Transmettre les trois pages pertinentes d'un rapport de quarante, isoler chaque bulletin d'une liasse de paie, séparer l'annexe technique du contrat principal : découper un PDF est souvent plus utile que l'envoyer entier. Cela évite de diffuser des informations qui ne concernent pas le destinataire et allège les échanges.",
      "Dans GigaPDF, la division se fait visuellement. Les miniatures de toutes les pages s'affichent, vous sélectionnez celles à extraire ou définissez les points de coupe, et le moteur génère des fichiers indépendants en copiant les pages sans les recompresser. L'opération inverse existe aussi : supprimer des pages d'un document pour n'en garder que l'essentiel, directement depuis le même écran.",
      "Chaque fichier produit reste un PDF complet et autonome, classable dans vos dossiers, taggable et retrouvable par la recherche plein texte de la GED. La division est incluse dans le plan gratuit, sans limite de fréquence d'utilisation, et fonctionne aussi sur une instance auto-hébergée.",
    ],
    howTo: {
      title: "Comment diviser un fichier PDF",
      steps: [
        "Importez le PDF à découper dans votre espace GigaPDF.",
        "Ouvrez la vue par miniatures pour visualiser l'ensemble des pages.",
        "Sélectionnez les pages à extraire, ou définissez les intervalles de découpe (par exemple 1-4, 5-12, 13-20).",
        "Lancez l'opération : chaque segment devient un fichier PDF indépendant.",
        "Renommez et classez les fichiers obtenus dans vos dossiers, puis partagez ceux qui doivent l'être.",
      ],
    },
    capabilities: [
      "Extraction d'une page, d'une plage ou d'une sélection libre de pages",
      "Découpe d'un document en plusieurs fichiers en une seule opération",
      "Sélection visuelle sur les miniatures, sans saisie de numéros à l'aveugle",
      "Pages copiées sans recompression : qualité strictement identique à l'original",
      "Suppression de pages et rotation depuis le même écran",
      "Classement immédiat des fichiers produits dans la GED",
    ],
    faq: [
      {
        question: "Puis-je extraire des pages non consécutives, par exemple les pages 2, 7 et 15 ?",
        answer:
          "Oui. La sélection se fait page par page sur les miniatures : vous cochez les pages 2, 7 et 15 et GigaPDF les assemble dans un nouveau fichier en respectant l'ordre choisi. Vous n'êtes pas limité aux plages continues.",
      },
      {
        question: "Le document d'origine est-il modifié quand je le divise ?",
        answer:
          "Non. La division crée de nouveaux fichiers et laisse l'original intact dans votre espace. Si vous préférez réellement amputer le document source, utilisez la suppression de pages dans l'éditeur ; l'historique de versions permet de toute façon de revenir en arrière.",
      },
      {
        question: "Comment découper un gros PDF en plusieurs parties égales ?",
        answer:
          "Définissez vos intervalles dans la boîte de découpe (par exemple toutes les 10 pages) : GigaPDF génère un fichier par segment en une seule passe. C'est la méthode la plus rapide pour fractionner une numérisation longue ou un export volumineux en lots gérables.",
      },
      {
        question: "Les fichiers extraits conservent-ils le texte cherchable et les liens ?",
        answer:
          "Oui. Les pages sont transférées avec leur contenu complet : texte sélectionnable, images, liens et annotations. Un PDF passé par l'OCR de GigaPDF conserve son calque texte invisible dans chaque fichier issu de la découpe.",
      },
    ],
    useCases: [
      "Extraire l'attestation utile d'une liasse administrative avant de la joindre à un dossier",
      "Séparer chaque exercice ou chaque client d'un export comptable global",
      "Isoler un chapitre de mémoire ou de support de cours pour le distribuer seul",
    ],
    relatedTools: ["fusionner-pdf", "organiser-pages-pdf", "compresser-pdf"],
    relatedSolutions: ["experts-comptables", "ressources-humaines", "education-etudiants"],
    icon: "scissors",
  },
  {
    slug: "compresser-pdf",
    name: "Compresser un PDF",
    category: "edit",
    appHref: "/compress",
    metaTitle: "Compresser un PDF en ligne gratuitement | GigaPDF",
    metaDescription:
      "Réduisez le poids de vos PDF sans sacrifier la lisibilité : nettoyage de structure et optimisation web par le moteur maison. Gratuit et open source.",
    h1: "Compresser un PDF : réduire le poids sans détruire le document",
    intro: [
      "Un PDF trop lourd se heurte vite aux limites du quotidien : messageries qui plafonnent les pièces jointes à 10 ou 25 Mo, formulaires administratifs qui refusent les fichiers volumineux, portails de dépôt qui expirent avant la fin du transfert. Les scans de plusieurs dizaines de pages et les exports bourrés d'images sont les premiers concernés.",
      "GigaPDF s'appuie sur son moteur maison pour compresser intelligemment : la passe de nettoyage de structure supprime les objets inutilisés, les polices dupliquées et les flux orphelins qui gonflent silencieusement les fichiers retravaillés, tandis que la linéarisation réorganise la structure pour un affichage progressif dans le navigateur — la première page apparaît avant la fin du téléchargement. Le contenu visible n'est pas dégradé : on élimine le superflu structurel plutôt que de pixelliser vos pages.",
      "Cette approche est particulièrement efficace sur les documents passés par plusieurs éditeurs successifs, qui accumulent des données mortes. La compression est incluse dans le plan gratuit et se combine naturellement avec la fusion ou la division : assemblez d'abord, compressez ensuite, partagez le résultat par lien.",
    ],
    howTo: {
      title: "Comment compresser un fichier PDF",
      steps: [
        "Importez le PDF volumineux dans votre espace GigaPDF.",
        "Lancez la compression depuis le menu d'actions du document.",
        "Le moteur maison nettoie la structure : objets inutilisés, doublons et flux orphelins sont supprimés.",
        "Le fichier est linéarisé pour un affichage progressif en ligne.",
        "Comparez le poids obtenu à l'original, puis téléchargez ou partagez la version allégée.",
      ],
    },
    capabilities: [
      "Nettoyage de structure : suppression des objets, polices et flux inutilisés",
      "Linéarisation pour un affichage page à page immédiat dans le navigateur",
      "Aucune dégradation du texte vectoriel ni des mises en page",
      "Particulièrement efficace sur les PDF retravaillés ou assemblés plusieurs fois",
      "Combinable avec la fusion et la division dans la même session",
      "Original conservé : la compression produit une version, l'historique garde le reste",
    ],
    faq: [
      {
        question: "Quelle réduction de poids puis-je espérer ?",
        answer:
          "Cela dépend de ce que contient le fichier. Les PDF passés par plusieurs outils accumulent des objets morts et des polices dupliquées : sur ces documents, le nettoyage structurel fait souvent gagner une part substantielle du poids. Un scan déjà optimisé, dont le poids vient presque uniquement des images, se réduira moins.",
      },
      {
        question: "La compression rend-elle mon texte flou ?",
        answer:
          "Non. La méthode de GigaPDF agit sur la structure du fichier — objets inutilisés, doublons, organisation des flux — et non sur une pixellisation du contenu. Le texte vectoriel reste net à tous les niveaux de zoom et les mises en page sont inchangées.",
      },
      {
        question: "Qu'apporte la linéarisation d'un PDF ?",
        answer:
          "Un PDF linéarisé est réorganisé pour que la première page s'affiche dès le début du téléchargement, sans attendre le fichier complet. C'est précieux pour les documents consultés en ligne ou partagés par lien : le destinataire commence à lire immédiatement, même sur une connexion lente.",
      },
      {
        question: "Puis-je compresser plusieurs documents d'affilée ?",
        answer:
          "Oui. La compression est une action disponible sur chaque document de votre espace, sans quota d'utilisation. Les limites du plan gratuit portent sur le stockage (5 Go) et le nombre de documents (1000), pas sur le nombre d'opérations effectuées.",
      },
    ],
    useCases: [
      "Faire passer un dossier scanné sous la limite de pièce jointe d'une messagerie ou d'un portail administratif",
      "Alléger les rapports archivés pour économiser l'espace de stockage de l'équipe",
      "Préparer des documents fluides à consulter en ligne via le partage par lien",
    ],
    relatedTools: ["fusionner-pdf", "diviser-pdf", "ocr-pdf"],
    relatedSolutions: ["architectes-btp", "associations", "experts-comptables"],
    icon: "file-archive",
  },
  {
    slug: "signer-pdf",
    name: "Signer un PDF",
    category: "secure",
    appHref: "/sign",
    metaTitle: "Signature électronique de PDF (PKCS#7) | GigaPDF",
    metaDescription:
      "Signez vos PDF avec un vrai certificat numérique P12/PFX : signature PKCS#7 vérifiable dans Adobe Reader. Gratuit, open source, auto-hébergeable.",
    h1: "Signer un PDF avec un certificat numérique",
    intro: [
      "Il faut distinguer deux choses que beaucoup d'outils confondent : apposer une image de paraphe sur une page, et signer numériquement un document. La première n'offre aucune garantie — n'importe qui peut copier l'image. La seconde scelle cryptographiquement le fichier : toute modification ultérieure invalide la signature, et l'identité du signataire est vérifiable par le destinataire.",
      "GigaPDF implémente la vraie signature numérique au standard PKCS#7 (sous-filtre adbe.pkcs7.detached, le format reconnu par Adobe Reader et les visionneuses conformes). Vous importez votre certificat au format P12/PFX — émis par votre autorité de certification, votre ordre professionnel ou votre infrastructure interne — et GigaPDF calcule l'empreinte du document, la chiffre avec votre clé privée et incorpore la signature dans le fichier. Le destinataire ouvre le PDF et voit immédiatement si le document est intact et qui l'a signé.",
      "Cette approche par certificat vous laisse maître de votre identité numérique : la clé privée reste la vôtre, là où les plateformes propriétaires signent en votre nom sur leurs serveurs. Et comme GigaPDF est open source et auto-hébergeable, une organisation peut opérer toute la chaîne de signature sur sa propre infrastructure.",
    ],
    howTo: {
      title: "Comment signer numériquement un PDF",
      steps: [
        "Importez le document à signer dans votre espace GigaPDF.",
        "Ouvrez l'outil de signature et chargez votre certificat P12/PFX avec son mot de passe.",
        "Positionnez le champ de signature à l'endroit voulu sur la page.",
        "Validez : GigaPDF calcule l'empreinte du document et incorpore la signature PKCS#7 détachée.",
        "Téléchargez le PDF signé : son intégrité est désormais vérifiable dans toute visionneuse conforme.",
      ],
    },
    capabilities: [
      "Signature numérique PKCS#7 au format adbe.pkcs7.detached",
      "Prise en charge des certificats P12/PFX (AC publiques, ordres professionnels, PKI internes)",
      "Vérification de l'intégrité : toute modification après signature est détectée",
      "Signature visible positionnable sur la page de votre choix",
      "Clé privée jamais déléguée à un tiers : vous signez avec votre propre certificat",
      "Chaîne entièrement auto-hébergeable pour les organisations soumises à des exigences strictes",
    ],
    faq: [
      {
        question: "Quelle est la différence avec une image de signature scannée ?",
        answer:
          "Une image se copie et ne protège rien. Une signature numérique PKCS#7 lie cryptographiquement votre identité au contenu exact du fichier : si une seule virgule change après la signature, la vérification échoue et la visionneuse l'affiche. C'est la base d'une signature à valeur probante.",
      },
      {
        question: "Où obtenir un certificat P12/PFX ?",
        answer:
          "Auprès d'une autorité de certification (les prestataires qualifiés délivrent des certificats sur clé ou en fichier), de votre ordre professionnel — les avocats français disposent par exemple de certificats via leur écosystème métier — ou de la PKI interne de votre entreprise. Le fichier P12/PFX contient votre certificat et votre clé privée, protégés par mot de passe.",
      },
      {
        question: "La signature est-elle reconnue dans Adobe Acrobat Reader ?",
        answer:
          "Oui. GigaPDF utilise le sous-filtre adbe.pkcs7.detached, le standard historique des signatures PDF. Adobe Reader affiche le panneau de signatures, vérifie l'intégrité du document et présente la chaîne de certification. La mention « valide » dépend ensuite de la confiance accordée à votre autorité de certification par le lecteur.",
      },
      {
        question: "Puis-je faire signer plusieurs personnes sur le même document ?",
        answer:
          "Oui, les signatures s'ajoutent successivement : chaque signataire appose la sienne avec son propre certificat, et chaque signature couvre l'état du document au moment où elle est posée. Les visionneuses conformes affichent l'historique complet des signatures.",
      },
      {
        question: "Que vaut juridiquement cette signature ?",
        answer:
          "Le niveau de reconnaissance dépend du certificat employé, pas de GigaPDF : avec un certificat qualifié délivré par un prestataire de confiance, vous êtes dans le cadre des signatures électroniques avancées ou qualifiées du règlement eIDAS. GigaPDF fournit le mécanisme technique standard ; la qualification juridique découle de votre certificat.",
      },
    ],
    useCases: [
      "Signer des contrats et des conventions avec une preuve d'intégrité vérifiable par l'autre partie",
      "Sceller des rapports, attestations ou livrables officiels avant diffusion",
      "Mettre en place une chaîne de signature interne sur une instance auto-hébergée",
    ],
    relatedTools: ["proteger-pdf", "pdf-a", "formulaires-pdf", "editer-pdf"],
    relatedSolutions: ["avocats", "ressources-humaines", "immobilier"],
    icon: "file-signature",
  },
  {
    slug: "ocr-pdf",
    name: "OCR PDF",
    category: "ocr",
    appHref: "/ocr",
    metaTitle: "OCR en ligne : scans et images vers texte | GigaPDF",
    metaDescription:
      "OCR en ligne sur vos PDF scannés et images : rendez votre contenu cherchable et copiable. Reconnaissance multilingue, gratuite et open source.",
    h1: "OCR : extraire le texte de vos scans et images",
    intro: [
      "Un document composé uniquement d'images — un PDF scanné, mais aussi une photo de document ou un fichier JPG ou PNG — n'est qu'une suite de photographies de pages : impossible d'y rechercher un mot, de copier un paragraphe ou d'en extraire les montants. Tant que le texte n'est pas reconnu, le fichier reste muet pour vos outils — y compris pour la recherche de votre propre GED. La reconnaissance optique de caractères (OCR) transforme ces images en texte exploitable.",
      "GigaPDF embarque son propre moteur de reconnaissance optique, qui charge par défaut l'ensemble de ses modèles : il lit non seulement le français, l'anglais, l'allemand, l'espagnol, l'italien, le portugais… mais aussi le cyrillique, l'arabe, l'hébreu, le tamoul, le devanagari, le télougou, le kannada, le chinois (simplifié et traditionnel), le japonais et le coréen — accents, cédilles et ligatures compris. Fondé sur les modèles PaddleOCR (état de l'art) exécutés sur notre propre infrastructure, il est conçu d'abord pour le texte imprimé et reconnaît aussi, sur demande, l'écriture manuscrite latine (français inclus), cyrillique et grecque. Il s'applique aussi bien à un PDF scanné qu'à une image seule (JPG, PNG) ou à la photo d'un document : vous lancez l'OCR, le moteur analyse chaque page ou image et restitue le texte reconnu, prêt à être copié, exporté ou indexé.",
      "L'OCR alimente directement le reste de la plateforme : une fois le document reconnu, la recherche plein texte de la GED le retrouve par son contenu, et l'outil de PDF cherchable peut incruster le texte en calque invisible sous l'image d'origine. Le tout fonctionne dans le plan gratuit, et sur votre propre serveur si vous auto-hébergez — un point décisif quand les documents et images scannés sont confidentiels.",
    ],
    howTo: {
      title: "Comment appliquer l'OCR à un scan ou à une image",
      steps: [
        "Importez votre PDF scanné ou directement une image (JPG, PNG, photo de document) dans GigaPDF.",
        "Lancez l'OCR depuis le menu d'actions du document.",
        "Le moteur OCR analyse chaque page ou image et reconnaît le texte dans de nombreuses langues et écritures.",
        "Récupérez le texte : copie directe, export TXT, ou génération d'un PDF cherchable.",
        "Le document devient trouvable par son contenu dans la recherche plein texte de votre espace.",
      ],
    },
    capabilities: [
      "Moteur OCR maison multilingue (latin, cyrillique, arabe, hébreu, écritures indiennes et CJK)",
      "Prise en charge des PDF scannés comme des images seules (JPG, PNG, photos de documents)",
      "Reconnaissance fidèle des accents et caractères spéciaux du français",
      "Traitement page par page des documents et images multipages",
      "Export du texte reconnu (TXT) ou génération d'un calque cherchable invisible",
      "Indexation du contenu reconnu dans la recherche plein texte de la GED",
      "Exécution sur votre propre serveur en auto-hébergement : les scans ne quittent pas votre infrastructure",
    ],
    faq: [
      {
        question: "Quelles langues l'OCR de GigaPDF reconnaît-il ?",
        answer:
          "Le moteur OCR charge l'ensemble de ses modèles par défaut : au-delà du français et de l'anglais, il reconnaît de nombreuses écritures — latine (allemand, espagnol, italien, portugais…), cyrillique, arabe, hébraïque, indiennes (tamoul, devanagari, télougou, kannada) et CJK (chinois simplifié et traditionnel, japonais, coréen). Un contrat bilingue ou une facture mêlant plusieurs langues est traité en une seule passe, et les caractères accentués sont correctement restitués. Le moteur, fondé sur les modèles PaddleOCR (état de l'art), est conçu d'abord pour le texte imprimé et reconnaît aussi, sur demande, l'écriture manuscrite latine (français inclus), cyrillique et grecque.",
      },
      {
        question: "Quelle qualité de scan ou d'image faut-il pour un bon résultat ?",
        answer:
          "L'OCR donne d'excellents résultats sur des scans nets à 300 dpi, ou des photos bien éclairées et cadrées d'un texte imprimé. Les documents inclinés, les photocopies de photocopies, les clichés flous ou les très petites tailles de caractères dégradent la reconnaissance ; mieux vaut numériser à plat, ou photographier bien à plat et en bonne résolution quand c'est possible.",
      },
      {
        question: "L'OCR reconnaît-il l'écriture manuscrite ?",
        answer:
          "Oui, sur demande. Le moteur est avant tout conçu pour le texte imprimé, mais une option à activer reconnaît aussi l'écriture manuscrite latine (français inclus), cyrillique et grecque, via des modèles entraînés par nos soins ; ce mode n'est jamais déclenché automatiquement, et les autres écritures restent limitées au texte imprimé. Pour un bon résultat, privilégiez des documents scannés nets ou photographiés à plat et en bonne résolution.",
      },
      {
        question: "Que devient le document ou l'image d'origine après l'OCR ?",
        answer:
          "Il n'est pas altéré. L'OCR produit du texte que vous exploitez comme vous voulez : copie, export, ou création d'un PDF cherchable où le texte reconnu est posé en calque invisible sous l'image du scan ou de la photo — le document garde alors son apparence exacte tout en devenant sélectionnable.",
      },
    ],
    useCases: [
      "Rendre exploitables des factures scannées ou photographiées : montants et références deviennent copiables et cherchables",
      "Numériser des archives papier et les retrouver ensuite par leur contenu, pas seulement par leur nom de fichier",
      "Extraire le texte d'un contrat reçu en scan, ou d'une photo de document prise au téléphone, pour le citer ou le réviser",
    ],
    relatedTools: ["pdf-cherchable", "compresser-pdf", "pdf-vers-word"],
    relatedSolutions: ["experts-comptables", "avocats", "sante"],
    icon: "scan-text",
  },
  {
    slug: "pdf-cherchable",
    appHref: "/documents",
    name: "PDF cherchable",
    category: "ocr",
    metaTitle: "Rendre un PDF cherchable (calque texte OCR) | GigaPDF",
    metaDescription:
      "Ajoutez un calque de texte invisible sur vos scans : le PDF garde son apparence et devient sélectionnable et cherchable. Gratuit, open source.",
    h1: "Rendre un PDF scanné cherchable sans changer son apparence",
    intro: [
      "C'est la technique dite du « PDF sandwich » : l'image numérisée — un scan, mais aussi une photo de document ou une image (JPG, PNG) convertie en PDF — reste affichée telle quelle, et le texte reconnu par OCR est inséré en dessous, dans un calque invisible parfaitement aligné sur les mots de l'image. Visuellement, rien ne change — le tampon, la signature manuscrite et la mise en page d'origine restent intacts. Mais le document répond désormais à Ctrl+F, le texte se sélectionne à la souris et les lecteurs d'écran peuvent le lire.",
      "GigaPDF construit ce calque à partir de son moteur OCR maison multilingue (latin, cyrillique, arabe, hébreu, écritures indiennes et CJK) : chaque mot reconnu est positionné aux coordonnées exactes où il apparaît dans l'image, si bien qu'une recherche surligne le bon endroit de la page et qu'un copier-coller suit l'ordre de lecture. C'est la différence avec un simple export texte, qui perd toute correspondance avec la page.",
      "Pour une GED, c'est l'étape qui change tout : un fonds documentaire scanné devient interrogeable en texte intégral. Combinée à la recherche plein texte de GigaPDF, la sandwich-isation transforme des années d'archives papier numérisées en base documentaire réellement consultable — sur le cloud ou sur votre propre serveur en auto-hébergement.",
    ],
    howTo: {
      title: "Comment ajouter un calque cherchable à un scan",
      steps: [
        "Importez le PDF scanné — ou une image (JPG, PNG, photo de document) — dans votre espace GigaPDF.",
        "Lancez la création du PDF cherchable depuis le menu d'actions.",
        "Le moteur OCR reconnaît le texte de chaque page (moteur multilingue).",
        "Le texte est incrusté en calque invisible, mot par mot, aux coordonnées de l'image.",
        "Téléchargez le résultat : apparence identique, mais texte sélectionnable et cherchable partout.",
      ],
    },
    capabilities: [
      "Calque de texte invisible aligné sur l'image d'origine (PDF sandwich)",
      "Apparence du document strictement inchangée : tampons et signatures visibles conservés",
      "Recherche Ctrl+F fonctionnelle dans toutes les visionneuses PDF",
      "Sélection et copier-coller du texte directement sur le scan",
      "Reconnaissance OCR maison multilingue (latin, cyrillique, arabe, hébreu, écritures indiennes et CJK)",
      "Indexation automatique dans la recherche plein texte de la GED GigaPDF",
    ],
    faq: [
      {
        question: "Quelle différence entre l'OCR simple et le PDF cherchable ?",
        answer:
          "L'OCR simple extrait le texte vers l'extérieur du document (copie, fichier TXT). Le PDF cherchable réinjecte ce texte dans le document lui-même, en calque invisible sous l'image : le fichier garde son apparence de scan mais se comporte comme un PDF natif pour la recherche, la sélection et l'accessibilité.",
      },
      {
        question: "Le calque invisible modifie-t-il l'aspect du document ?",
        answer:
          "Non, par construction : le texte est inséré en mode de rendu invisible, sous l'image numérisée. À l'écran comme à l'impression, le document est identique au scan d'origine. Seuls les comportements changent : la recherche trouve, la souris sélectionne.",
      },
      {
        question: "La recherche surligne-t-elle le bon endroit de la page ?",
        answer:
          "Oui. Chaque mot du calque est positionné aux coordonnées où le moteur OCR l'a détecté dans l'image. Quand votre visionneuse surligne un résultat de recherche, le surlignage tombe sur le mot visible correspondant — ce qui rend la consultation de gros documents scannés réellement praticable.",
      },
      {
        question: "Est-ce utile pour l'accessibilité ?",
        answer:
          "Oui. Un scan brut est inaccessible aux lecteurs d'écran, qui n'y voient qu'une image. Avec le calque texte, le contenu devient vocalisable et navigable. La qualité dépend de celle de la reconnaissance : un scan net donne un calque fidèle.",
      },
    ],
    useCases: [
      "Convertir un fonds d'archives numérisées en base documentaire interrogeable par mots-clés",
      "Rendre les contrats scannés cherchables tout en conservant tampons et signatures visibles",
      "Améliorer l'accessibilité de documents distribués initialement sous forme de scans",
    ],
    relatedTools: ["ocr-pdf", "compresser-pdf", "pdf-a"],
    relatedSolutions: ["avocats", "experts-comptables", "architectes-btp"],
    icon: "file-search",
  },
  {
    slug: "proteger-pdf",
    name: "Protéger un PDF",
    category: "secure",
    appHref: "/protect",
    metaTitle: "Protéger un PDF : mot de passe et chiffrement | GigaPDF",
    metaDescription:
      "Chiffrez vos PDF en AES-256 ou AES-128 et contrôlez impression, copie et modification. Protection par mot de passe gratuite et open source.",
    h1: "Protéger un PDF par mot de passe et chiffrement",
    intro: [
      "Envoyer un bulletin de salaire, un relevé médical ou une offre commerciale par e-mail, c'est accepter que le fichier circule au-delà du destinataire prévu : transferts, boîtes partagées, pièces jointes archivées par des serveurs tiers. Le chiffrement du PDF lui-même est la parade la plus simple — le document devient illisible sans le mot de passe, où qu'il se trouve.",
      "GigaPDF chiffre vos fichiers au standard PDF avec deux algorithmes au choix : AES-256, le niveau recommandé aujourd'hui, et AES-128, largement compatible ; les PDF hérités protégés en RC4 restent lisibles en déchiffrement, mais le chiffrement actif se fait toujours en AES. Vous définissez un mot de passe d'ouverture et, séparément, un mot de passe propriétaire assorti de permissions granulaires : autoriser ou interdire l'impression, la copie de texte, la modification du contenu, les annotations, le remplissage de formulaires, l'extraction de contenu, l'assemblage du document et l'impression haute qualité.",
      "La distinction entre les deux mots de passe est précieuse : vous pouvez diffuser un document lisible par tous mais verrouillé en modification, ou au contraire totalement confidentiel. Le chiffrement s'applique en un clic depuis votre espace, sans supplément — comme toutes les fonctions de GigaPDF, il est inclus dans le plan gratuit et disponible en auto-hébergement.",
    ],
    howTo: {
      title: "Comment protéger un PDF par mot de passe",
      steps: [
        "Importez le document à protéger dans votre espace GigaPDF.",
        "Ouvrez l'outil de protection et choisissez l'algorithme : AES-256 recommandé.",
        "Définissez le mot de passe d'ouverture, à transmettre au destinataire par un canal séparé.",
        "Réglez les permissions : impression, copie, modification, annotations, remplissage de formulaires, extraction de contenu, assemblage et impression haute qualité.",
        "Validez et téléchargez le PDF chiffré : sans mot de passe, son contenu est illisible.",
      ],
    },
    capabilities: [
      "Chiffrement AES-256 ou AES-128 selon vos contraintes de compatibilité",
      "Déchiffrement des PDF hérités protégés en RC4 pris en charge (lecture)",
      "Mot de passe d'ouverture (lecture) distinct du mot de passe propriétaire (droits)",
      "8 permissions granulaires : impression, copie de texte, modification, annotations, remplissage de formulaires, extraction de contenu, assemblage du document, impression haute qualité",
      "Suppression de la protection d'un fichier dont vous connaissez le mot de passe",
      "Application en un clic depuis la GED, sans logiciel à installer",
      "Chaîne complète opérable sur votre propre serveur en auto-hébergement",
    ],
    faq: [
      {
        question: "Quel algorithme de chiffrement choisir ?",
        answer:
          "AES-256 dans la quasi-totalité des cas : c'est le standard le plus robuste pris en charge par le format PDF et par toutes les visionneuses modernes. AES-128 reste un choix sûr si vous visez de très vieux lecteurs. GigaPDF chiffre uniquement en AES ; RC4, obsolète sur le plan cryptographique, n'est pris en charge qu'en déchiffrement, pour ouvrir des PDF hérités déjà protégés avec cet algorithme.",
      },
      {
        question: "Quelle différence entre mot de passe d'ouverture et mot de passe propriétaire ?",
        answer:
          "Le mot de passe d'ouverture est exigé pour lire le document. Le mot de passe propriétaire contrôle les droits : un fichier peut s'ouvrir librement mais refuser l'impression ou la copie tant que ce second mot de passe n'est pas fourni. Les deux se combinent selon votre besoin de confidentialité.",
      },
      {
        question: "Les restrictions de copie et d'impression sont-elles infaillibles ?",
        answer:
          "Non, et il faut le savoir : les permissions PDF sont respectées par les visionneuses conformes, mais un outil malveillant peut les ignorer dès lors que le document s'ouvre. Pour une confidentialité réelle, utilisez le mot de passe d'ouverture avec AES-256 : sans lui, le contenu est cryptographiquement illisible.",
      },
      {
        question: "Que faire si j'oublie le mot de passe d'un PDF chiffré en AES-256 ?",
        answer:
          "Il n'existe pas de porte dérobée : c'est précisément ce qui fait la valeur du chiffrement. Conservez vos mots de passe dans un gestionnaire dédié. Si le fichier d'origine non chiffré est encore dans votre espace GigaPDF, l'historique de versions vous permet de le récupérer et de rechiffrer.",
      },
    ],
    useCases: [
      "Envoyer bulletins de paie et documents RH chiffrés, le mot de passe transitant par un autre canal",
      "Diffuser une étude ou un devis lisible mais verrouillé contre la modification et la copie",
      "Archiver des documents médicaux ou juridiques chiffrés en AES-256 dans la GED",
    ],
    relatedTools: ["signer-pdf", "filigrane-pdf", "pdf-a", "editer-pdf"],
    relatedSolutions: ["sante", "ressources-humaines", "avocats"],
    icon: "lock",
  },
  {
    slug: "filigrane-pdf",
    name: "Filigrane PDF",
    category: "edit",
    appHref: "/watermark",
    metaTitle: "Ajouter un filigrane à un PDF en ligne | GigaPDF",
    metaDescription:
      "Apposez un filigrane texte ou image (logo) sur toutes les pages d'un PDF : CONFIDENTIEL, BROUILLON, marque… Gratuit et open source.",
    h1: "Ajouter un filigrane texte ou image sur un PDF",
    intro: [
      "Un document sans marquage circule sans contexte : une version de travail est prise pour définitive, une étude confidentielle se retrouve transférée, un devis est réutilisé par un concurrent sans attribution. Le filigrane répond à ces trois situations d'un coup : il imprime le statut du document — BROUILLON, CONFIDENTIEL, SPÉCIMEN — ou votre identité visuelle sur chaque page, de manière indissociable du contenu.",
      "GigaPDF applique deux types de filigranes : du texte, dont vous choisissez le contenu, la taille, la couleur, l'opacité et l'inclinaison (la diagonale translucide classique), ou une image — typiquement votre logo — positionnée et dosée pour rester discrète sans disparaître. Le filigrane est inscrit dans le contenu des pages au moment du traitement, pas posé comme une annotation supprimable en deux clics depuis n'importe quelle visionneuse.",
      "Précision qui a son importance : GigaPDF n'ajoute jamais son propre filigrane publicitaire sur vos fichiers, contrairement à nombre d'outils « gratuits ». Les filigranes sont les vôtres, appliqués quand vous le décidez, y compris dans le plan gratuit et sur instance auto-hébergée.",
    ],
    howTo: {
      title: "Comment ajouter un filigrane à un PDF",
      steps: [
        "Importez le document à marquer dans votre espace GigaPDF.",
        "Choisissez le type de filigrane : texte libre ou image (votre logo).",
        "Réglez l'apparence : position, taille, opacité, rotation pour la diagonale classique.",
        "Appliquez : le filigrane est inscrit sur toutes les pages du document.",
        "Téléchargez ou partagez le PDF marqué ; l'original reste disponible dans l'historique.",
      ],
    },
    capabilities: [
      "Filigrane texte : contenu, police, taille, couleur, opacité et rotation réglables",
      "Filigrane image : logo ou tampon graphique avec opacité dosée",
      "Application sur l'ensemble des pages en une opération",
      "Filigrane inscrit dans le contenu de la page, pas une simple annotation amovible",
      "Aucun filigrane publicitaire GigaPDF ajouté à vos fichiers",
      "Original conservé grâce à l'historique de versions",
    ],
    faq: [
      {
        question: "Le filigrane peut-il être retiré par le destinataire ?",
        answer:
          "GigaPDF inscrit le filigrane dans le contenu des pages, ce qui le rend bien plus solide qu'une annotation, supprimable en deux clics. Un utilisateur outillé et déterminé peut toujours retravailler un PDF ; pour un engagement fort, combinez filigrane, chiffrement AES avec restriction de modification, et signature numérique qui révèle toute altération.",
      },
      {
        question: "Puis-je utiliser mon logo en filigrane sans écraser le texte du document ?",
        answer:
          "Oui : l'opacité se règle finement. Un logo à 10-15 % d'opacité, centré ou placé en pied de page, marque le document sans gêner la lecture ni l'impression. Vous prévisualisez le rendu avant d'appliquer.",
      },
      {
        question: "Peut-on filigraner plusieurs documents avec le même réglage ?",
        answer:
          "Oui. Vos réglages (texte, opacité, position) se réappliquent d'un document à l'autre, et l'API de GigaPDF — incluse à hauteur de 1 000 appels par mois dans le plan gratuit — permet d'automatiser le marquage systématique des fichiers d'un flux documentaire.",
      },
      {
        question: "Quelle est la différence entre un filigrane et un tampon ?",
        answer:
          "Le filigrane est appliqué uniformément sur toutes les pages, en arrière-plan ou en surimpression translucide : il qualifie le document entier. Le tampon est une annotation ponctuelle posée à un endroit précis d'une page — « Validé », « Reçu le… ». GigaPDF propose les deux : le filigrane ici, les tampons via l'outil d'annotation.",
      },
    ],
    useCases: [
      "Marquer BROUILLON ou CONFIDENTIEL les versions de travail avant relecture externe",
      "Apposer le logo du cabinet ou de l'agence sur les livrables envoyés aux clients",
      "Étiqueter SPÉCIMEN des documents types diffusés à des fins de démonstration",
    ],
    relatedTools: ["proteger-pdf", "annoter-pdf", "editer-pdf"],
    relatedSolutions: ["freelances", "enseignants-formateurs", "immobilier"],
    icon: "stamp",
  },
  {
    slug: "organiser-pages-pdf",
    name: "Organiser les pages",
    category: "organize",
    appHref: "/organize-pages",
    metaTitle: "Organiser un PDF : trier et pivoter les pages | GigaPDF",
    metaDescription:
      "Réordonnez, faites pivoter, supprimez ou extrayez les pages d'un PDF par glisser-déposer sur miniatures. Gratuit, open source, auto-hébergeable.",
    h1: "Organiser les pages d'un PDF : réordonner, pivoter, supprimer",
    intro: [
      "Les numérisations recto-verso qui intercalent les pages dans le désordre, les scans passés à l'envers dans le chargeur, la page 12 qui aurait dû être la 3 : remettre de l'ordre dans un PDF est l'une des opérations les plus banales — et les plus pénibles quand l'outil impose de ressaisir des numéros de pages à l'aveugle.",
      "GigaPDF affiche le document en planche de miniatures : chaque page se voit, s'attrape et se déplace par glisser-déposer. La rotation se corrige page par page ou par lot (90°, 180°, 270°), les pages blanches ou inutiles se suppriment d'un clic, et une sélection s'extrait en nouveau fichier sans quitter l'écran. Le moteur applique l'ensemble des changements en une passe, sans recompresser le contenu des pages.",
      "Chaque réorganisation crée une nouvelle version dans l'historique du document : un faux mouvement se rattrape en restaurant l'état précédent. Cette ergonomie visuelle, combinée à la fusion et à la division, couvre tout le cycle de préparation d'un dossier — assembler, ordonner, épurer — depuis le navigateur, gratuitement.",
    ],
    howTo: {
      title: "Comment réorganiser les pages d'un PDF",
      steps: [
        "Ouvrez votre document dans GigaPDF et passez en vue miniatures.",
        "Glissez-déposez les pages pour corriger l'ordre du document.",
        "Sélectionnez les pages à pivoter et appliquez la rotation 90°, 180° ou 270°.",
        "Supprimez les pages blanches ou hors sujet d'un clic.",
        "Enregistrez : les changements sont appliqués en une passe et l'ancienne version reste restaurable.",
      ],
    },
    capabilities: [
      "Réorganisation par glisser-déposer sur la planche de miniatures",
      "Rotation par page ou par lot : 90°, 180°, 270°",
      "Suppression de pages et extraction d'une sélection en nouveau fichier",
      "Application des modifications en une passe, sans recompression du contenu",
      "Historique de versions : chaque réorganisation est réversible",
      "Enchaînement direct avec la fusion, la division et la compression",
    ],
    faq: [
      {
        question: "Comment corriger un scan recto-verso dont les pages sont intercalées dans le désordre ?",
        answer:
          "C'est le cas d'école de la vue miniatures : vous voyez d'un coup d'œil la séquence réelle (1, 3, 5… puis 2, 4, 6…) et vous replacez les pages par glisser-déposer. Sur un document long, l'extraction des pages paires puis une re-fusion ordonnée peut aller encore plus vite — les deux outils s'enchaînent dans GigaPDF.",
      },
      {
        question: "La rotation est-elle enregistrée définitivement dans le fichier ?",
        answer:
          "Oui. La rotation appliquée dans GigaPDF est inscrite dans le PDF lui-même : le document s'ouvrira dans le bon sens dans toutes les visionneuses, à l'écran comme à l'impression — contrairement à la rotation d'affichage temporaire que proposent certains lecteurs.",
      },
      {
        question: "Puis-je annuler une réorganisation après l'avoir enregistrée ?",
        answer:
          "Oui. Chaque enregistrement crée une version dans l'historique du document. Vous pouvez consulter les versions précédentes et restaurer celle d'avant la manipulation, ce qui rend l'opération sans risque même sur un document important.",
      },
      {
        question: "Que deviennent les pages supprimées ?",
        answer:
          "Elles disparaissent de la version courante du document, mais restent présentes dans les versions antérieures de l'historique. Et si vous supprimez un document entier par erreur, la corbeille de la GED le conserve 30 jours avant suppression définitive.",
      },
    ],
    useCases: [
      "Remettre dans l'ordre une numérisation dont les pages sont mélangées ou à l'envers",
      "Épurer un dossier avant envoi : retirer pages blanches, doublons et brouillons",
      "Recomposer un document à partir de plusieurs sources puis l'ordonner visuellement",
    ],
    relatedTools: ["fusionner-pdf", "diviser-pdf", "editer-pdf"],
    relatedSolutions: ["immobilier", "experts-comptables", "ressources-humaines"],
    icon: "layout-grid",
  },
  {
    slug: "annoter-pdf",
    appHref: "/documents",
    name: "Annoter un PDF",
    category: "edit",
    metaTitle: "Annoter un PDF en ligne : notes et surlignage | GigaPDF",
    metaDescription:
      "Surlignez, commentez et dessinez sur vos PDF avec des annotations natives lisibles dans toutes les visionneuses. Gratuit et open source.",
    h1: "Annoter un PDF : surligner, commenter, dessiner",
    intro: [
      "Relire un contrat, corriger un mémoire, commenter une maquette : le travail sur document est d'abord un travail de marge. Imprimer pour annoter au stylo puis rescanner fait perdre le texte cherchable et la qualité ; commenter dans un e-mail séparé déconnecte les remarques de leur contexte. L'annotation directe dans le PDF garde chaque commentaire à l'endroit exact qu'il concerne.",
      "GigaPDF écrit des annotations natives au standard PDF : surlignage, notes, texte libre, formes et tracés sont enregistrés comme objets d'annotation conformes, et non aplatis en image. Concrètement, vos marques restent visibles et listables dans Adobe Reader, dans l'aperçu macOS, dans un navigateur — et le destinataire peut y répondre avec son propre outil, même s'il n'utilise pas GigaPDF.",
      "La collaboration en temps réel ajoute la dimension d'équipe : plusieurs relecteurs annotent le même document simultanément et voient les marques des autres apparaître en direct. Combiné au partage par lien et à l'historique de versions de la GED, le cycle de relecture entier se passe au même endroit, sans pièce jointe.",
    ],
    howTo: {
      title: "Comment annoter un document PDF",
      steps: [
        "Ouvrez le PDF dans l'éditeur GigaPDF.",
        "Surlignez les passages clés en sélectionnant le texte.",
        "Ajoutez des notes et commentaires aux endroits qui appellent une remarque.",
        "Dessinez si besoin : flèches, cadres et tracés libres pour pointer un détail visuel.",
        "Partagez le document par lien : vos annotations sont visibles dans toutes les visionneuses, et l'équipe peut annoter en temps réel.",
      ],
    },
    capabilities: [
      "Surlignage du texte avec choix de couleur",
      "Notes et commentaires positionnés au point exact qu'ils concernent",
      "Texte libre, formes et dessin à main levée sur la page",
      "Annotations natives au standard PDF, lisibles dans toutes les visionneuses",
      "Annotation collaborative en temps réel à plusieurs sur le même fichier",
      "Partage par lien ou e-mail et historique de versions intégrés",
    ],
    faq: [
      {
        question: "Mes annotations seront-elles visibles dans Adobe Reader ?",
        answer:
          "Oui. GigaPDF enregistre des annotations natives conformes au standard PDF : Adobe Reader, l'aperçu macOS, les navigateurs et les autres visionneuses les affichent et les listent dans leur panneau de commentaires. Rien n'est propriétaire ni enfermé dans la plateforme.",
      },
      {
        question: "Peut-on annoter à plusieurs en même temps ?",
        answer:
          "Oui, c'est l'un des points forts de GigaPDF : la collaboration en temps réel permet à plusieurs relecteurs d'ouvrir le même document et de voir les annotations des autres apparaître en direct, sans conflit de versions ni fusion manuelle de commentaires.",
      },
      {
        question: "Quelle différence entre annoter et éditer le PDF ?",
        answer:
          "L'annotation se superpose au contenu sans le modifier : c'est la couche de relecture, listable et attribuable. L'édition change le contenu lui-même — corriger le texte, remplacer une image. GigaPDF fait les deux, dans le même éditeur, mais il est utile de choisir : on annote une proposition, on édite son propre document.",
      },
      {
        question: "Puis-je figer les annotations pour qu'elles ne soient plus modifiables ?",
        answer:
          "Oui, c'est le rôle de l'aplatissement, disponible dans l'outil formulaires de GigaPDF : il fond les annotations dans le contenu des pages. Elles restent visibles mais ne sont plus des objets séparés modifiables — utile avant archivage ou diffusion finale.",
      },
    ],
    useCases: [
      "Relire un contrat à plusieurs en surlignant les clauses à renégocier",
      "Corriger des copies ou des mémoires avec notes en marge, sans imprimer",
      "Commenter un état des lieux ou un plan directement sur le document de référence",
    ],
    relatedTools: ["editer-pdf", "filigrane-pdf", "formulaires-pdf"],
    relatedSolutions: ["education-etudiants", "enseignants-formateurs", "architectes-btp"],
    icon: "highlighter",
  },
  {
    slug: "formulaires-pdf",
    appHref: "/documents",
    name: "Formulaires PDF",
    category: "edit",
    metaTitle: "Remplir un formulaire PDF en ligne | GigaPDF",
    metaDescription:
      "Remplissez les champs d'un formulaire PDF dans le navigateur et aplatissez le résultat pour figer les réponses. Gratuit et open source.",
    h1: "Remplir et aplatir des formulaires PDF",
    intro: [
      "Les formulaires PDF interactifs — champs AcroForm avec zones de texte, cases à cocher et listes — sont partout dans la vie administrative : demandes officielles, formulaires d'inscription, documents d'embauche. Encore faut-il un outil qui les remplisse correctement : nombre de visionneuses gratuites affichent les champs mais perdent les saisies à l'enregistrement, ou forcent l'impression-rescan.",
      "GigaPDF lit la structure du formulaire, présente chaque champ à la saisie dans le navigateur et enregistre les valeurs dans le fichier, conformément au standard. Troisième opération, souvent décisive : l'aplatissement. Il fond les champs remplis dans le contenu des pages — les réponses deviennent du contenu définitif, non modifiable par un simple clic dans le champ. C'est l'étape qui sépare un brouillon de formulaire d'un document à transmettre.",
      "Pour les organisations, la lecture des champs par l'API ouvre l'automatisation : extraire les valeurs saisies dans les formulaires reçus sans ressaisie manuelle. Le plan gratuit inclut le remplissage, l'aplatissement et 1 000 appels API par mois ; l'auto-hébergement garde les formulaires sensibles sur votre infrastructure.",
    ],
    howTo: {
      title: "Comment remplir un formulaire PDF",
      steps: [
        "Importez le formulaire PDF dans votre espace GigaPDF.",
        "Ouvrez-le : les champs interactifs (texte, cases, listes) sont détectés automatiquement.",
        "Saisissez vos réponses directement dans le navigateur.",
        "Enregistrez les valeurs dans le fichier, ou aplatissez le formulaire pour figer définitivement les réponses.",
        "Téléchargez, partagez par lien, ou signez ensuite numériquement le document complété.",
      ],
    },
    capabilities: [
      "Détection et lecture des champs de formulaire (AcroForm)",
      "Remplissage dans le navigateur : texte, cases à cocher, listes",
      "Enregistrement des valeurs conforme au standard PDF",
      "Aplatissement : les réponses sont fondues dans la page, non modifiables",
      "Extraction des valeurs saisies via l'API pour automatiser le traitement",
      "Enchaînement naturel avec la signature numérique PKCS#7",
    ],
    faq: [
      {
        question: "Pourquoi aplatir un formulaire après l'avoir rempli ?",
        answer:
          "Tant que les champs restent interactifs, n'importe quel destinataire peut modifier vos réponses d'un clic. L'aplatissement transforme les valeurs saisies en contenu de page définitif : le document se fige tel que vous l'avez complété. C'est la bonne pratique avant transmission officielle ou archivage.",
      },
      {
        question: "Que faire d'un formulaire non interactif, simple page scannée avec des lignes vides ?",
        answer:
          "S'il n'y a pas de champs AcroForm, le remplissage de formulaire n'a pas de prise — mais l'éditeur GigaPDF prend le relais : ajoutez des zones de texte par-dessus les lignes du document, positionnées précisément, puis enregistrez. Le résultat est équivalent à un formulaire complété.",
      },
      {
        question: "Les listes déroulantes et cases à cocher sont-elles gérées ?",
        answer:
          "Oui. GigaPDF lit les différents types de champs du standard : zones de texte, cases à cocher, boutons radio et listes. Chaque champ se manipule dans le navigateur comme dans un formulaire web, et la valeur est écrite dans le fichier à l'enregistrement.",
      },
      {
        question: "Puis-je récupérer automatiquement les réponses des formulaires que je reçois ?",
        answer:
          "Oui, via l'API : la lecture des champs retourne les valeurs saisies de manière structurée, ce qui évite la ressaisie quand vous collectez des dizaines de formulaires identiques. Le plan gratuit comprend 1 000 appels API par mois — de quoi automatiser un flux régulier.",
      },
    ],
    useCases: [
      "Compléter des documents administratifs ou d'embauche sans imprimante ni scanner",
      "Figer par aplatissement les réponses d'un formulaire avant envoi officiel",
      "Collecter des formulaires remplis et en extraire les valeurs automatiquement par API",
    ],
    relatedTools: ["signer-pdf", "editer-pdf", "annoter-pdf"],
    relatedSolutions: ["ressources-humaines", "associations", "immobilier"],
    icon: "clipboard-list",
  },
  {
    slug: "pdf-vers-word",
    name: "PDF vers Word",
    category: "convert",
    appHref: "/pdf-to-word",
    metaTitle: "Convertir un PDF en Word (DOCX) en ligne | GigaPDF",
    metaDescription:
      "Transformez vos PDF en documents Word modifiables (.docx), mise en page préservée. Conversion gratuite, open source, sans filigrane.",
    h1: "Convertir un PDF en document Word modifiable",
    intro: [
      "Le PDF fige, Word libère : quand il faut reprendre intégralement un document — restructurer un rapport, réutiliser les paragraphes d'un contrat type, repartir d'une trame existante — l'édition ponctuelle ne suffit plus, il faut retrouver un fichier traitement de texte. La conversion PDF vers DOCX reconstruit le document dans un format où chaque élément redevient malléable.",
      "GigaPDF analyse la structure du PDF — blocs de texte, paragraphes, images, tableaux — et génère un fichier .docx ouvert par Word, votre suite bureautique ou Google Docs. Les conversions fidèles exigent un vrai travail de reconstruction : respecter l'enchaînement des paragraphes plutôt que de produire une zone de texte par ligne, conserver les images à leur place, restituer les tableaux en tableaux. C'est ce que vise le moteur de conversion, exécuté côté serveur.",
      "Un cas mérite une mention : les PDF scannés. Sans texte numérique, il n'y a rien à convertir — passez d'abord le document à l'OCR multilingue de GigaPDF, puis convertissez. La chaîne scan → OCR → DOCX transforme un papier numérisé en document Word retravaillable, entièrement dans la même plateforme, gratuitement.",
    ],
    howTo: {
      title: "Comment convertir un PDF en Word",
      steps: [
        "Importez le PDF à convertir dans votre espace GigaPDF.",
        "S'il s'agit d'un scan, lancez d'abord l'OCR pour reconnaître le texte.",
        "Choisissez l'export au format DOCX dans le menu de conversion.",
        "Le moteur reconstruit paragraphes, images et tableaux dans le fichier Word.",
        "Téléchargez le .docx et ouvrez-le dans Word, votre suite bureautique ou Google Docs.",
      ],
    },
    capabilities: [
      "Export DOCX compatible Word, suites bureautiques et Google Docs",
      "Reconstruction des paragraphes, images et tableaux",
      "Conversion côté serveur, sans installation locale",
      "Chaîne scan → OCR → DOCX pour les documents numérisés",
      "Aucun filigrane ajouté sur le document converti",
      "Exports complémentaires depuis le même menu : ODT, TXT, HTML, PNG, JPEG",
    ],
    faq: [
      {
        question: "La mise en page sera-t-elle identique à l'original ?",
        answer:
          "L'objectif est la fidélité maximale, mais soyons honnêtes : PDF et DOCX décrivent les documents différemment, et les mises en page très graphiques (colonnes imbriquées, texte sur images, plaquettes design) peuvent demander des ajustements après conversion. Les documents textuels classiques — rapports, contrats, courriers — se convertissent très proprement.",
      },
      {
        question: "Puis-je convertir un PDF scanné en Word ?",
        answer:
          "Oui, en deux temps : l'OCR d'abord, la conversion ensuite. Un scan ne contient que des images ; l'OCR maison multilingue de GigaPDF en extrait le texte, qui alimente alors la conversion DOCX. Sans cette étape, le fichier Word ne contiendrait que des images de pages.",
      },
      {
        question: "Les tableaux du PDF restent-ils des tableaux dans Word ?",
        answer:
          "Les structures tabulaires détectées sont restituées en tableaux Word, modifiables cellule par cellule. Les tableaux très complexes — cellules fusionnées en cascade, tableaux dessinés sans structure — peuvent être partiellement simplifiés ; un contrôle visuel après conversion reste recommandé sur ces cas.",
      },
      {
        question: "Y a-t-il une limite de taille ou un filigrane sur la conversion gratuite ?",
        answer:
          "Aucun filigrane, jamais. La conversion est une fonction complète du plan gratuit, dont les limites sont le stockage (5 Go) et le nombre de documents (1000) — pas une dégradation du résultat. Le fichier produit vous appartient, propre.",
      },
    ],
    useCases: [
      "Reprendre un contrat ou un rapport dont vous n'avez plus le fichier source",
      "Réutiliser le contenu d'une documentation PDF dans un nouveau livrable Word",
      "Transformer des courriers scannés en documents modifiables via OCR puis conversion",
    ],
    relatedTools: ["word-vers-pdf", "ocr-pdf", "pdf-vers-odt"],
    relatedSolutions: ["freelances", "education-etudiants", "avocats"],
    icon: "file-text",
  },
  {
    slug: "word-vers-pdf",
    name: "Word vers PDF",
    category: "convert",
    appHref: "/office-to-pdf",
    metaTitle: "Convertir Word en PDF (.doc, .docx, .odt) | GigaPDF",
    metaDescription:
      "Convertissez vos documents Word et ODT en PDF fidèles : .docx, anciens .doc et .odt. Gratuit, open source, sans filigrane.",
    h1: "Convertir un document Word en PDF",
    intro: [
      "Envoyer un .docx, c'est envoyer un document vivant : il s'affichera différemment selon la version de Word, les polices installées et la machine du destinataire — quand il ne sera pas modifié en route. Le passage en PDF verrouille la mise en page : ce que vous avez composé est exactement ce qui sera lu et imprimé, partout.",
      "GigaPDF convertit avec son moteur de conversion bureautique maison exécuté côté serveur, éprouvé et fidèle. Il prend en charge le .docx moderne, l'ancien format .doc — celui des archives Word 97-2003 qui traînent dans tous les serveurs de fichiers et que beaucoup de convertisseurs en ligne refusent — et le format ouvert .odt des suites OpenDocument. Styles, tableaux, images, en-têtes et pieds de page sont rendus dans un PDF propre, sans filigrane publicitaire.",
      "Vous n'avez pas besoin de Microsoft Office, ni d'aucune installation : le navigateur suffit. Et le PDF produit atterrit directement dans votre GED GigaPDF, où il peut être fusionné avec d'autres pièces, signé numériquement, protégé par chiffrement ou archivé en PDF/A — la conversion n'est que la première étape d'une chaîne documentaire complète.",
    ],
    howTo: {
      title: "Comment convertir un fichier Word en PDF",
      steps: [
        "Importez votre fichier .docx, .doc ou .odt dans votre espace GigaPDF.",
        "Lancez la conversion : le moteur maison restitue le document côté serveur.",
        "Vérifiez le PDF obtenu dans la visionneuse intégrée.",
        "Enchaînez si besoin : fusion avec d'autres pièces, signature, chiffrement ou filigrane.",
        "Téléchargez le PDF ou partagez-le par lien directement depuis la GED.",
      ],
    },
    capabilities: [
      "Conversion des .docx, des anciens .doc (Word 97-2003) et des .odt (OpenDocument)",
      "Moteur de conversion maison côté serveur : aucune installation, pas besoin de Microsoft Office",
      "Restitution des styles, tableaux, images, en-têtes et pieds de page",
      "Aucun filigrane sur le PDF produit",
      "Enchaînement immédiat : fusion, signature numérique, chiffrement, PDF/A",
      "Import des autres formats bureautiques depuis le même flux : Excel (.xls, .xlsx, .ods), PowerPoint (.ppt, .pptx, .odp)",
    ],
    faq: [
      {
        question: "Quels formats de traitement de texte sont acceptés en entrée ?",
        answer:
          "Trois : le .docx moderne, l'ancien format binaire .doc (Word 97-2003) que beaucoup de convertisseurs refusent, et le .odt des suites OpenDocument. Le moteur maison lit les trois et les rend en PDF sans réouverture manuelle dans Word — précieux pour numériser proprement un historique documentaire hétérogène.",
      },
      {
        question: "La mise en page de mon document sera-t-elle respectée ?",
        answer:
          "Le moteur maison restitue fidèlement la très grande majorité des documents : styles, tableaux, images ancrées, en-têtes, pieds de page et numérotation. Les documents dépendant de polices propriétaires non embarquées ou de macros d'affichage peuvent présenter de légers écarts ; un coup d'œil au PDF dans la visionneuse intégrée suffit à le vérifier.",
      },
      {
        question: "Puis-je convertir plusieurs documents Word d'affilée ?",
        answer:
          "Oui. Importez vos fichiers par lot et convertissez-les successivement ; via l'API, l'opération s'automatise pour les flux réguliers (1 000 appels par mois inclus dans le plan gratuit). Chaque PDF produit est classé dans votre GED, taggable et cherchable.",
      },
      {
        question: "Le PDF produit est-il modifiable ensuite ?",
        answer:
          "Oui, doublement : vous conservez le Word d'origine dans votre espace, et le PDF lui-même reste éditable dans l'éditeur WYSIWYG de GigaPDF pour les retouches ponctuelles — corriger une date, masquer une mention — sans regénérer tout le document.",
      },
    ],
    useCases: [
      "Figer un CV, un devis ou un contrat avant envoi, à l'identique sur tous les écrans",
      "Convertir en masse d'anciennes archives .doc en PDF consultables",
      "Préparer des documents Word à la signature numérique : conversion puis PKCS#7 dans la foulée",
    ],
    relatedTools: ["pdf-vers-word", "excel-vers-pdf", "powerpoint-vers-pdf", "signer-pdf"],
    relatedSolutions: ["freelances", "ressources-humaines", "associations"],
    icon: "file-input",
  },
  {
    slug: "excel-vers-pdf",
    name: "Excel vers PDF",
    category: "convert",
    appHref: "/office-to-pdf",
    metaTitle: "Convertir Excel en PDF (.xls, .xlsx, .ods) | GigaPDF",
    metaDescription:
      "Convertissez vos classeurs Excel et ODS en PDF propres et imprimables : .xlsx, anciens .xls et .ods. Gratuit et open source.",
    h1: "Convertir un classeur Excel en PDF",
    intro: [
      "Un tableur transmis en .xlsx est un document à risques : formules visibles, onglets de travail oubliés, colonnes masquées qu'un clic révèle, et une mise en page qui explose à l'impression chez le destinataire. Pour communiquer des chiffres — devis, tableau de bord, budget — le PDF présente le résultat, et seulement le résultat, exactement cadré.",
      "GigaPDF convertit vos classeurs avec son moteur maison côté serveur : les formats .xlsx, .xls (Excel 97-2003) et .ods (OpenDocument) sont acceptés, les valeurs calculées remplacent les formules, et la zone d'impression définie dans le classeur structure la pagination du PDF. Bordures, couleurs de cellules, graphiques et formats de nombres sont restitués tels que le tableur les affiche.",
      "Conseil hérité de l'impression : la qualité du PDF se joue dans le classeur, avant conversion. Une zone d'impression définie, une orientation paysage pour les tableaux larges et un ajustement « une page en largeur » donnent un document final net. Une fois converti, le PDF se fusionne avec vos autres pièces, se protège par mot de passe ou se filigrane — sans quitter GigaPDF, gratuitement.",
    ],
    howTo: {
      title: "Comment convertir un fichier Excel en PDF",
      steps: [
        "Préparez le classeur : zone d'impression et orientation définies dans votre tableur.",
        "Importez le fichier .xlsx, .xls ou .ods dans votre espace GigaPDF.",
        "Lancez la conversion : le moteur maison calcule le rendu et pagine le document.",
        "Contrôlez le PDF dans la visionneuse : coupures de colonnes, lisibilité des chiffres.",
        "Téléchargez, fusionnez avec d'autres pièces ou partagez le PDF par lien.",
      ],
    },
    capabilities: [
      "Conversion des .xlsx, des anciens .xls (Excel 97-2003) et des .ods (OpenDocument)",
      "Valeurs calculées dans le PDF : les formules ne sont pas exposées",
      "Respect des zones d'impression et de l'orientation définies dans le classeur",
      "Restitution des bordures, couleurs, graphiques et formats de nombres",
      "Classeurs OpenDocument .ods traités par le même moteur maison",
      "Fusion, protection et filigrane du PDF produit dans la même plateforme",
    ],
    faq: [
      {
        question: "Comment éviter qu'un tableau large soit coupé sur plusieurs pages ?",
        answer:
          "Réglez-le dans le classeur avant conversion : orientation paysage et ajustement « une page en largeur » dans les options de mise en page de votre tableur. Le moteur maison applique ces réglages lors de la conversion ; un tableau sans mise en page définie sera paginé par défaut, avec des coupures possibles.",
      },
      {
        question: "Les formules de mon classeur apparaissent-elles dans le PDF ?",
        answer:
          "Non, et c'est l'un des intérêts de la conversion : le PDF contient les valeurs calculées, pas les formules. Vos méthodes de calcul, hypothèses intermédiaires et références de cellules restent dans le fichier source, que vous gardez pour vous.",
      },
      {
        question: "Tous les onglets du classeur sont-ils convertis ?",
        answer:
          "La conversion suit la configuration d'impression du classeur. Pour ne diffuser qu'un onglet de synthèse, définissez-le comme zone d'impression avant l'import — ou supprimez les pages superflues du PDF après conversion grâce à l'outil d'organisation des pages de GigaPDF.",
      },
      {
        question: "Les graphiques Excel sont-ils conservés ?",
        answer:
          "Oui, les graphiques sont rendus dans le PDF tels qu'ils apparaissent dans le classeur. Ils deviennent des éléments graphiques figés : c'est le but — le destinataire voit la courbe, pas les données sous-jacentes ni les séries masquées.",
      },
    ],
    useCases: [
      "Envoyer un devis ou un budget chiffré sans exposer formules et hypothèses de calcul",
      "Figer un tableau de bord mensuel en PDF pour diffusion et archivage",
      "Joindre des annexes chiffrées paginées proprement à un rapport fusionné",
    ],
    relatedTools: ["word-vers-pdf", "powerpoint-vers-pdf", "fusionner-pdf"],
    relatedSolutions: ["experts-comptables", "freelances", "associations"],
    icon: "file-spreadsheet",
  },
  {
    slug: "powerpoint-vers-pdf",
    name: "PowerPoint vers PDF",
    category: "convert",
    appHref: "/office-to-pdf",
    metaTitle: "Convertir PowerPoint en PDF (.ppt, .pptx, .odp) | GigaPDF",
    metaDescription:
      "Convertissez vos présentations PowerPoint et ODP en PDF fidèles : .pptx, anciens .ppt et .odp. Gratuit, open source, sans filigrane.",
    h1: "Convertir une présentation PowerPoint en PDF",
    intro: [
      "Une présentation envoyée en .pptx arrive rarement intacte : polices substituées, animations qui n'ont plus de sens à l'arrêt, slides décalées selon la version de PowerPoint — et un fichier modifiable par n'importe qui. Le support qui circule après la réunion mérite mieux : un PDF où chaque diapositive est figée exactement comme vous l'avez conçue.",
      "GigaPDF s'appuie sur son moteur maison côté serveur pour convertir les .pptx, les anciens .ppt (PowerPoint 97-2003) et les .odp (présentations OpenDocument). Chaque diapositive devient une page du PDF : arrière-plans, images, schémas et blocs de texte sont rendus à leur position exacte. Les animations et transitions, propres au mode diaporama, sont naturellement absentes du support figé — c'est l'état final de chaque slide qui est restitué.",
      "Le PDF obtenu est plus léger à diffuser qu'un .pptx chargé d'images, lisible sur tout appareil sans PowerPoint, et imprimable proprement. Besoin d'aller plus loin ? GigaPDF exporte aussi dans l'autre sens (PDF vers PPTX) pour reprendre un vieux support dont le fichier source a disparu — les deux sens de conversion sont inclus dans le plan gratuit.",
    ],
    howTo: {
      title: "Comment convertir un PowerPoint en PDF",
      steps: [
        "Importez votre présentation .pptx, .ppt ou .odp dans votre espace GigaPDF.",
        "Lancez la conversion : chaque diapositive est rendue en page PDF par le moteur maison.",
        "Vérifiez le résultat dans la visionneuse : polices, images et schémas en place.",
        "Appliquez si besoin un filigrane ou une protection avant diffusion.",
        "Téléchargez le PDF ou partagez-le par lien, lisible sans PowerPoint.",
      ],
    },
    capabilities: [
      "Conversion des .pptx, des anciens .ppt (PowerPoint 97-2003) et des .odp (OpenDocument)",
      "Une diapositive = une page PDF, à la mise en page exacte",
      "Restitution des arrière-plans, images, schémas et zones de texte",
      "Conversion inverse disponible : export d'un PDF vers PPTX",
      "Présentations OpenDocument .odp traitées par le même moteur maison",
      "Filigrane, protection et partage par lien depuis la même plateforme",
    ],
    faq: [
      {
        question: "Que deviennent les animations et transitions de ma présentation ?",
        answer:
          "Elles disparaissent, par nature : un PDF est un support figé, sans mode diaporama. Chaque diapositive est rendue dans son état final, tous éléments visibles. Si une slide révèle des blocs progressivement, pensez à vérifier que leur superposition finale reste lisible une fois figée.",
      },
      {
        question: "Les polices spéciales de ma présentation seront-elles respectées ?",
        answer:
          "Les polices embarquées ou standard sont restituées fidèlement. Une police exotique non disponible côté moteur de conversion est remplacée par la plus proche — comme le ferait PowerPoint sur une machine où elle manque. Le PDF de contrôle dans la visionneuse permet de le vérifier en quelques secondes.",
      },
      {
        question: "Puis-je convertir un PDF en PowerPoint, dans l'autre sens ?",
        answer:
          "Oui. GigaPDF propose l'export PDF vers PPTX : chaque page redevient une diapositive avec ses textes et images, modifiable dans PowerPoint ou votre logiciel de présentation. C'est la solution quand le fichier source d'un support a été perdu et qu'il faut le faire évoluer.",
      },
      {
        question: "Le PDF est-il plus léger que la présentation d'origine ?",
        answer:
          "Souvent, oui : le PDF ne transporte ni les animations, ni les médias inutilisés, ni les masques de diapositives multiples. Et si le résultat reste lourd — présentations très riches en photos — l'outil de compression maison de GigaPDF le réduit encore d'une passe.",
      },
    ],
    useCases: [
      "Diffuser le support d'une formation ou d'une conférence après la session, figé et lisible partout",
      "Archiver les présentations clients en PDF dans la GED, cherchables et versionnées",
      "Imprimer proprement un jeu de slides pour une réunion sans vidéoprojecteur",
    ],
    relatedTools: ["word-vers-pdf", "excel-vers-pdf", "compresser-pdf", "filigrane-pdf"],
    relatedSolutions: ["enseignants-formateurs", "freelances", "associations"],
    icon: "presentation",
  },
  {
    slug: "opendocument-pdf",
    name: "OpenDocument et PDF",
    category: "convert",
    appHref: "/office-to-pdf",
    metaTitle: "Convertir OpenDocument en PDF (ODT, ODS, ODP) | GigaPDF",
    metaDescription:
      "Convertissez ODT, ODS et ODP en PDF, et repassez du PDF vers ODT ou ODP. Le pont OpenDocument ↔ PDF, gratuit et open source.",
    h1: "OpenDocument vers PDF, et retour : ODT, ODS, ODP",
    intro: [
      "Les administrations, les collectivités et les organisations attachées au logiciel libre travaillent en OpenDocument : textes .odt, classeurs .ods, présentations .odp. Format ouvert, normalisé ISO — mais minoritaire face à l'écosystème Microsoft, ce qui complique les échanges : le destinataire n'a pas toujours de suite compatible OpenDocument, et la plupart des convertisseurs en ligne ignorent purement ces formats.",
      "GigaPDF les traite en citoyens de première classe, et pour cause : son moteur de conversion maison gère nativement OpenDocument, exécuté côté serveur. Les trois formats se convertissent en PDF avec une fidélité native — styles, tableaux, graphiques et mises en page restitués sans approximation d'un convertisseur tiers. Et le chemin inverse existe : un PDF s'exporte en ODT pour retravailler le texte, ou en ODP pour reprendre une présentation, refermant la boucle avec votre suite bureautique libre.",
      "Cette cohérence open source va jusqu'au bout de la chaîne : GigaPDF est publié en « source-available » sous licence PolyForm Noncommercial 1.0.0 et s'auto-héberge. Une organisation qui privilégie les logiciels ouverts et auditables pour sa bureautique peut faire le même choix pour sa plateforme documentaire — conversion, édition, signature et GED comprises, sans dépendre d'un service propriétaire.",
    ],
    howTo: {
      title: "Comment convertir entre OpenDocument et PDF",
      steps: [
        "Importez votre fichier .odt, .ods ou .odp dans votre espace GigaPDF.",
        "Lancez la conversion en PDF : le moteur maison restitue le document à l'identique.",
        "Vérifiez le rendu dans la visionneuse intégrée.",
        "Pour le sens inverse, ouvrez un PDF et exportez-le en ODT (texte) ou ODP (présentation).",
        "Classez, partagez ou signez le résultat directement dans la GED.",
      ],
    },
    capabilities: [
      "Conversion en PDF des textes .odt, classeurs .ods et présentations .odp",
      "Moteur de conversion maison côté serveur : fidélité maximale au format OpenDocument",
      "Export inverse du PDF vers ODT et ODP pour retravailler les contenus",
      "Classeurs : export des données d'un PDF vers XLSX exploitable dans votre tableur",
      "Aucun filigrane, conversion incluse dans le plan gratuit",
      "Plateforme source-available auto-hébergeable : la chaîne documentaire ouverte de bout en bout",
    ],
    faq: [
      {
        question: "Pourquoi la conversion OpenDocument est-elle plus fiable ici qu'ailleurs ?",
        answer:
          "Parce que GigaPDF convertit avec son moteur maison, conçu pour le format OpenDocument, exécuté côté serveur. Là où d'autres services passent par des bibliothèques de réinterprétation approximatives — quand ils acceptent ces formats —, GigaPDF utilise un rendu natif : ce que la suite bureautique affiche est ce que le PDF contient.",
      },
      {
        question: "Puis-je reconvertir un PDF en fichier OpenDocument modifiable ?",
        answer:
          "Oui pour les textes et les présentations : l'export ODT reconstruit un document texte modifiable et l'export ODP des diapositives reprenables dans Impress. Pour les données tabulaires d'un PDF, l'export se fait en XLSX, que votre tableur ouvre et réenregistre en .ods nativement.",
      },
      {
        question: "Les documents .ods avec graphiques et formules sont-ils bien rendus ?",
        answer:
          "Oui : les classeurs sont convertis avec leurs valeurs calculées, leurs formats de cellules et leurs graphiques, selon la zone d'impression définie. Comme pour Excel, les formules restent dans le fichier source — le PDF expose les résultats, pas la mécanique.",
      },
      {
        question: "GigaPDF est-il adapté à une administration sous contrainte de souveraineté ?",
        answer:
          "C'est l'un de ses terrains naturels : code source auditable, auto-hébergement complet sur vos serveurs, formats ouverts en entrée comme en sortie. Aucun document n'a besoin de transiter par un cloud tiers, et aucune licence propriétaire n'entre dans la chaîne.",
      },
    ],
    useCases: [
      "Diffuser en PDF des documents produits sous une suite OpenDocument à des destinataires non équipés",
      "Reprendre en ODT un PDF dont le fichier source a disparu, sans passer par Word",
      "Outiller une organisation attachée aux logiciels ouverts : suite OpenDocument + GigaPDF auto-hébergé",
    ],
    relatedTools: ["pdf-vers-odt", "word-vers-pdf", "pdf-a"],
    relatedSolutions: ["associations", "education-etudiants", "sante"],
    icon: "file-stack",
  },
  {
    slug: "pdf-vers-odt",
    name: "PDF vers ODT",
    category: "convert",
    appHref: "/pdf-to-odt",
    metaTitle: "Convertir un PDF en ODT (OpenDocument) | GigaPDF",
    metaDescription:
      "Transformez un PDF en document ODT modifiable dans votre traitement de texte, texte et images repris. Conversion gratuite et open source.",
    h1: "Convertir un PDF en ODT modifiable dans votre suite OpenDocument",
    intro: [
      "Pour qui travaille sous une suite OpenDocument, convertir un PDF en .docx est un détour absurde : il faut ensuite réimporter le fichier Word dans le traitement de texte, avec une couche de conversion supplémentaire et son lot d'écarts. GigaPDF offre le chemin direct : du PDF vers l'ODT, le format natif des traitements de texte OpenDocument, en une seule transformation.",
      "Le moteur analyse le PDF — paragraphes, images, structure de page — et reconstruit un document texte OpenDocument : le texte redevient des paragraphes éditables avec leurs attributs, les images reprennent leur place, et le fichier s'ouvre dans Writer comme n'importe quel .odt, prêt à être restylé avec vos modèles. Pour les PDF scannés, l'OCR maison intégré (moteur multilingue) fournit d'abord le texte, la conversion fait le reste.",
      "Ce choix de format n'est pas anodin : l'ODT est une norme ISO ouverte, lisible aujourd'hui et dans vingt ans, sans dépendance à un éditeur. GigaPDF — open source, auto-hébergeable, sans filigrane — complète logiquement cette philosophie : vos documents repassent du format figé au format libre, avec des outils libres.",
    ],
    howTo: {
      title: "Comment convertir un PDF en ODT",
      steps: [
        "Importez le PDF dans votre espace GigaPDF.",
        "S'il s'agit d'un document scanné, appliquez d'abord l'OCR pour reconnaître le texte.",
        "Choisissez l'export au format ODT dans le menu de conversion.",
        "Le moteur reconstruit paragraphes et images en document OpenDocument.",
        "Ouvrez le .odt dans votre traitement de texte et reprenez la rédaction.",
      ],
    },
    capabilities: [
      "Export ODT natif, sans détour par le format Word",
      "Reconstruction des paragraphes éditables et reprise des images",
      "Chaîne scan → OCR maison → ODT pour les documents numérisés",
      "Fichier conforme OpenDocument, ouvert par Writer et tout éditeur compatible",
      "Aucun filigrane sur le document converti",
      "Autres exports disponibles au même endroit : DOCX, ODP, TXT, HTML",
    ],
    faq: [
      {
        question: "Pourquoi convertir directement en ODT plutôt qu'en DOCX puis ouvrir dans Writer ?",
        answer:
          "Chaque conversion de format introduit ses approximations. Passer par DOCX en ajoute une seconde : PDF vers DOCX, puis DOCX vers le modèle interne de Writer. L'export ODT direct de GigaPDF n'en fait qu'une, vers le format que Writer parle nativement — moins d'écarts, moins de reprises.",
      },
      {
        question: "Le document converti garde-t-il sa mise en forme ?",
        answer:
          "Le texte revient avec ses attributs essentiels — corps, graisse, alignements — et les images à leur position. Comme pour toute conversion depuis PDF, un document très graphique peut demander des retouches dans Writer ; un rapport, un courrier ou un contrat se reprend en général directement.",
      },
      {
        question: "Puis-je convertir un scan en ODT ?",
        answer:
          "Oui, en chaînant deux outils GigaPDF : l'OCR d'abord, qui reconnaît le texte du scan dans de nombreuses langues et écritures, puis l'export ODT, qui le structure en document Writer. Sans l'étape OCR, un scan n'a pas de texte à convertir.",
      },
      {
        question: "Le fichier ODT produit est-il standard ?",
        answer:
          "Oui : c'est un document OpenDocument conforme, lisible par toute suite OpenDocument et tout logiciel respectant la norme ISO 26300 — y compris Word, qui ouvre les .odt. Vous n'êtes enfermé ni dans GigaPDF ni dans aucun éditeur.",
      },
    ],
    useCases: [
      "Reprendre dans Writer un document officiel diffusé uniquement en PDF",
      "Réintégrer d'anciens livrables PDF dans une chaîne éditoriale OpenDocument",
      "Convertir des courriers scannés en ODT retravaillables via l'OCR intégré",
    ],
    relatedTools: ["opendocument-pdf", "pdf-vers-word", "ocr-pdf"],
    relatedSolutions: ["associations", "education-etudiants", "avocats"],
    icon: "file-output",
  },
  {
    slug: "html-vers-pdf",
    name: "HTML vers PDF",
    category: "convert",
    appHref: "/html-to-pdf",
    metaTitle: "Convertir HTML ou une page web en PDF | GigaPDF",
    metaDescription:
      "Transformez du HTML ou une URL en PDF rendu par le moteur maison : CSS moderne, polices web, pages longues. Gratuit, open source, avec API.",
    h1: "Convertir du HTML ou une page web en PDF",
    intro: [
      "Le web est devenu la source de la plupart des documents : factures générées par les applications, confirmations de commande, articles, rapports produits par des outils internes. Les figer en PDF — pour archiver, prouver, transmettre — exige un rendu exact. Or le HTML moderne (flexbox, grid, polices web, contenu injecté par JavaScript) dépasse largement ce que savent restituer les bibliothèques de conversion légères.",
      "GigaPDF prend le problème par le bon bout : le rendu est confié à son moteur HTML/CSS maison, piloté côté serveur. Vous fournissez du code HTML ou simplement une URL ; la page est chargée, les styles appliqués, les polices web téléchargées, puis le document est imprimé en PDF exactement comme le ferait le navigateur. Ce que vous voyez en ligne est ce que contient le fichier.",
      "C'est aussi un outil d'automatisation de premier plan : via l'API GigaPDF (1 000 appels par mois inclus dans le plan gratuit), vos applications génèrent leurs factures, attestations et rapports en envoyant du HTML — le langage de gabarit le plus universel qui soit — et reçoivent des PDF prêts à archiver dans la GED. En auto-hébergement, cette chaîne tourne entièrement sur vos serveurs.",
    ],
    howTo: {
      title: "Comment convertir une page web en PDF",
      steps: [
        "Indiquez la source : une URL publique ou votre code HTML complet.",
        "Le moteur maison charge la page côté serveur : CSS, polices web et mise en page appliqués.",
        "Le rendu est imprimé en PDF, fidèle à l'affichage navigateur.",
        "Récupérez le document dans votre espace GigaPDF, prêt à être classé ou partagé.",
        "Pour automatiser, appelez la même conversion par API depuis vos applications.",
      ],
    },
    capabilities: [
      "Rendu par le moteur HTML/CSS maison : fidèle au web, pas une approximation",
      "Conversion depuis une URL ou depuis du code HTML fourni",
      "Prise en charge du CSS moderne (flexbox, grid) et des polices web",
      "Génération automatisée par API : factures, attestations, rapports",
      "PDF classé directement dans la GED : dossiers, tags, recherche, partage",
      "Exécution intégralement sur vos serveurs en auto-hébergement",
    ],
    faq: [
      {
        question: "Pourquoi le rendu HTML/CSS maison fait-il la différence ?",
        answer:
          "Parce que les convertisseurs HTML légers implémentent un sous-ensemble daté du CSS : les mises en page en flexbox ou grid s'effondrent, les polices web manquent, le JavaScript n'est pas exécuté. Le moteur maison de GigaPDF gère le CSS moderne, les polices web et l'exécution du JavaScript — le PDF produit correspond fidèlement à ce que montre un navigateur.",
      },
      {
        question: "Puis-je générer mes factures en PDF automatiquement ?",
        answer:
          "Oui, c'est le cas d'usage type : votre application construit la facture en HTML (un gabarit avec vos styles), l'envoie à l'API GigaPDF et reçoit le PDF. Le plan gratuit inclut 1 000 appels API par mois ; le document peut être archivé, protégé ou signé numériquement dans la foulée.",
      },
      {
        question: "Les pages nécessitant une connexion sont-elles convertibles ?",
        answer:
          "La conversion par URL charge la page telle qu'elle est accessible publiquement : un contenu derrière authentification n'y apparaîtra pas. La solution robuste consiste à fournir directement le HTML — votre application, elle, a accès aux données et construit le document complet avant conversion.",
      },
      {
        question: "Comment maîtriser la pagination du PDF produit ?",
        answer:
          "Avec les outils standard du CSS d'impression, que le moteur maison honore : propriétés page-break/break-inside pour contrôler les coupures, règles @media print pour adapter les styles, @page pour les marges. Un gabarit HTML bien préparé donne des PDF paginés au cordeau, reproductibles à chaque génération.",
      },
    ],
    useCases: [
      "Générer automatiquement factures et attestations en PDF depuis vos applications via l'API",
      "Archiver une page web — article, annonce, conditions en vigueur — telle qu'affichée à une date donnée",
      "Produire des rapports PDF à partir de gabarits HTML stylés, reproductibles à l'identique",
    ],
    relatedTools: ["pdf-a", "compresser-pdf", "proteger-pdf"],
    relatedSolutions: ["freelances", "immobilier", "experts-comptables"],
    icon: "globe",
  },
  {
    slug: "pdf-a",
    name: "PDF/A",
    category: "organize",
    appHref: "/pdf-a",
    metaTitle: "Convertir en PDF/A : archivage conforme | GigaPDF",
    metaDescription:
      "Convertissez vos PDF au format d'archivage PDF/A-1b ou PDF/A-2b, conforme ISO 19005. Outil gratuit, open source et auto-hébergeable.",
    h1: "Convertir un PDF en PDF/A pour l'archivage à long terme",
    intro: [
      "Un PDF ordinaire ne garantit rien sur la durée : polices non embarquées qui s'afficheront autrement dans dix ans, contenus dépendant de ressources externes, éléments dynamiques. Pour les documents qui engagent — contrats, factures, dossiers réglementaires — la norme ISO 19005 a défini le PDF/A : un profil restreint du PDF où tout ce qui est nécessaire à l'affichage est contenu dans le fichier, pour toujours.",
      "GigaPDF convertit vos documents vers deux niveaux de conformité : PDF/A-1b, le profil historique le plus largement exigé par les administrations, et PDF/A-2b, plus récent, qui autorise notamment la compression JPEG2000 et la transparence — souvent le meilleur choix pour les documents contemporains. La conversion embarque les polices, normalise les espaces colorimétriques et inscrit les métadonnées de conformité que les validateurs vérifient.",
      "L'archivage conforme est fréquemment une obligation : marchés publics, conservation des factures, procédures dématérialisées et systèmes d'archivage électronique exigent du PDF/A en entrée. Avec GigaPDF, la mise en conformité est une opération d'un clic — ou un appel d'API pour traiter les flux —, incluse dans le plan gratuit et opérable sur votre propre infrastructure.",
    ],
    howTo: {
      title: "Comment convertir un document en PDF/A",
      steps: [
        "Importez le PDF à mettre en conformité dans votre espace GigaPDF.",
        "Choisissez le niveau cible : PDF/A-1b (exigence classique) ou PDF/A-2b (profil plus récent).",
        "Lancez la conversion : polices embarquées, couleurs normalisées, métadonnées de conformité inscrites.",
        "Récupérez le fichier conforme, prêt pour le dépôt ou le système d'archivage.",
        "Conservez l'original dans la GED : versions, tags et recherche plein texte restent disponibles.",
      ],
    },
    capabilities: [
      "Conversion vers PDF/A-1b et PDF/A-2b (ISO 19005)",
      "Polices embarquées dans le fichier : affichage identique dans le temps",
      "Normalisation des espaces colorimétriques et métadonnées XMP de conformité",
      "Traitement unitaire en un clic ou en flux via l'API",
      "Combinable avec l'OCR : un scan devient une archive conforme et cherchable",
      "Auto-hébergement possible pour les politiques d'archivage internes strictes",
    ],
    faq: [
      {
        question: "PDF/A-1b ou PDF/A-2b : lequel choisir ?",
        answer:
          "Suivez d'abord l'exigence du destinataire : si une administration ou un SAE impose un niveau, la question est tranchée. À défaut, PDF/A-2b est généralement préférable pour les documents actuels — il accepte la transparence et des compressions plus efficaces — tandis que PDF/A-1b reste la valeur sûre face aux systèmes anciens.",
      },
      {
        question: "Qu'est-ce qui change concrètement dans mon fichier ?",
        answer:
          "Tout ce qui rendrait l'affichage dépendant de l'extérieur est résolu : les polices sont embarquées, les couleurs rattachées à un profil explicite, les métadonnées de conformité inscrites au format XMP. Les contenus interdits par la norme — éléments dynamiques, dépendances externes — sont neutralisés. Visuellement, le document reste le même.",
      },
      {
        question: "Un PDF/A est-il encore modifiable ou signable ?",
        answer:
          "Le PDF/A reste un PDF : techniquement lisible et éditable partout. L'esprit de l'archivage veut qu'on fige le document — et la bonne pratique consiste à le signer numériquement (PKCS#7, disponible dans GigaPDF) : toute modification ultérieure devient détectable, ce qui complète la garantie de pérennité par une garantie d'intégrité.",
      },
      {
        question: "Puis-je rendre un scan conforme PDF/A et cherchable à la fois ?",
        answer:
          "Oui, c'est la chaîne d'archivage idéale dans GigaPDF : OCR maison pour reconnaître le texte, calque cherchable invisible pour le rendre exploitable, puis conversion PDF/A. Le document final est à la fois pérenne, conforme et interrogeable en texte intégral.",
      },
    ],
    useCases: [
      "Mettre les factures et pièces comptables au format exigé pour la conservation légale",
      "Déposer des documents conformes dans les téléprocédures et marchés publics",
      "Constituer des archives de cabinet pérennes : OCR + PDF/A + signature numérique",
    ],
    relatedTools: ["signer-pdf", "ocr-pdf", "pdf-cherchable", "proteger-pdf"],
    relatedSolutions: ["avocats", "experts-comptables", "sante"],
    icon: "archive",
  },
  {
    slug: "fusion-universelle",
    name: "Fusion universelle",
    category: "organize",
    metaTitle: "Fusion universelle : tout fichier en un PDF | GigaPDF",
    metaDescription:
      "Fusionnez PDF, Word, Excel, PowerPoint, OpenDocument, images et HTML en un seul PDF. Chaque fichier converti puis assemblé. Gratuit, open source.",
    h1: "Fusion universelle : réunir n'importe quels fichiers en un seul PDF",
    intro: [
      "La fusion classique a une limite frustrante : elle n'assemble que des PDF. Or un dossier réel est rarement homogène — un contrat en Word, un budget en Excel, un support en PowerPoint, des justificatifs photographiés, une page web exportée. Les réunir oblige d'ordinaire à convertir chaque pièce à la main, une par une, avant de pouvoir les combiner. La fusion universelle supprime cette corvée.",
      "Vous déposez vos fichiers tels quels, quel que soit leur format : PDF, documents Word (.doc, .docx) et OpenDocument texte (.odt), classeurs Excel (.xls, .xlsx) et tableurs .ods, présentations PowerPoint (.ppt, .pptx) et .odp, images JPG, PNG, GIF, WebP et AVIF, pages HTML, fichiers texte. GigaPDF convertit chaque pièce en PDF avec son moteur maison côté serveur, puis assemble l'ensemble dans l'ordre que vous définissez — un document unique, paginé en continu, prêt à transmettre. C'est l'outil phare de la plateforme : tout ce qui peut devenir une page de PDF se fond dans le même fichier final.",
      "Le résultat rejoint votre GED comme n'importe quel document : taggable, cherchable en texte intégral, partageable par lien. Aucun filigrane n'est ajouté, et la fonction est incluse dans le plan gratuit. Pour les organisations attachées à la confidentialité, toute la chaîne — conversions comprises — s'exécute sur votre propre serveur en auto-hébergement.",
    ],
    howTo: {
      title: "Comment fusionner des fichiers de formats différents en un PDF",
      steps: [
        "Importez tous vos fichiers dans GigaPDF : PDF, Word, Excel, PowerPoint, OpenDocument, images, HTML ou texte.",
        "Sélectionnez les pièces à réunir, sans vous soucier de leur format d'origine.",
        "Glissez-déposez les fichiers pour définir l'ordre d'assemblage final.",
        "Lancez la fusion universelle : chaque pièce non-PDF est d'abord convertie par le moteur maison.",
        "Toutes les pièces converties sont assemblées en un seul PDF paginé en continu.",
        "Classez, partagez ou téléchargez le document unique obtenu depuis votre espace.",
      ],
    },
    capabilities: [
      "Fusion de formats hétérogènes en un seul PDF : PDF, bureautique, images, HTML, texte",
      "Conversion automatique de chaque pièce non-PDF par le moteur maison avant assemblage",
      "Prise en charge de Word (.doc, .docx), Excel (.xls, .xlsx), PowerPoint (.ppt, .pptx) et OpenDocument (.odt, .ods, .odp)",
      "Intégration des images JPG, PNG et WebP comme pages du document final",
      "Définition libre de l'ordre des pièces avant la fusion",
      "Aucun filigrane ajouté, résultat classé dans la GED et partageable par lien",
    ],
    faq: [
      {
        question: "Quels formats puis-je mélanger dans une même fusion ?",
        answer:
          "Tous ceux que GigaPDF sait transformer en page de PDF : les PDF eux-mêmes, les documents Word et OpenDocument texte, les classeurs Excel et .ods, les présentations PowerPoint et .odp, les images JPG, PNG et WebP, le HTML et les fichiers texte. Vous pouvez réunir un contrat Word, un budget Excel et trois justificatifs photographiés dans un seul fichier, en une opération.",
      },
      {
        question: "Comment les fichiers non-PDF sont-ils intégrés ?",
        answer:
          "Chaque pièce qui n'est pas déjà un PDF est d'abord convertie par le moteur maison de GigaPDF — une diapositive devient une page, une image occupe une page, un document Word est rendu fidèlement. Les PDF obtenus sont ensuite assemblés dans l'ordre choisi. Le résultat est un PDF unique et homogène, sans trace des formats d'origine.",
      },
      {
        question: "L'ordre des fichiers dans le document final est-il modifiable ?",
        answer:
          "Oui, avant la fusion : vous réordonnez les pièces par glisser-déposer pour fixer la séquence d'assemblage. Et après, si un ajustement s'impose, le document fusionné s'ouvre dans l'éditeur où la vue en miniatures permet de déplacer, faire pivoter ou retirer n'importe quelle page.",
      },
      {
        question: "La fidélité des conversions est-elle préservée dans la fusion ?",
        answer:
          "La conversion de chaque pièce s'appuie sur le même moteur maison que les outils de conversion dédiés de GigaPDF — la fidélité est donc identique. Les documents textuels classiques se convertissent très proprement ; les mises en page très graphiques peuvent demander, comme toujours, un contrôle visuel sur le document final.",
      },
      {
        question: "Y a-t-il un filigrane ou une limite sur la fusion universelle ?",
        answer:
          "Aucun filigrane n'est jamais apposé. La fonction est incluse dans le plan gratuit, dont les seules limites portent sur le stockage (5 Go) et le nombre de documents, pas sur le nombre de pièces réunies ni d'opérations effectuées.",
      },
    ],
    useCases: [
      "Assembler un dossier complet — contrat Word, budget Excel, justificatifs photographiés — en un seul PDF à transmettre",
      "Réunir des sources hétérogènes (présentation, page web, scans) en un support unique paginé",
      "Constituer une liasse de candidature ou de subvention sans convertir chaque pièce à la main",
    ],
    relatedTools: ["fusionner-pdf", "image-vers-pdf", "word-vers-pdf", "organiser-pages-pdf"],
    relatedSolutions: ["associations", "experts-comptables", "immobilier"],
    icon: "combine",
    appHref: "/merge",
  },
  {
    slug: "image-vers-pdf",
    name: "Image vers PDF",
    category: "convert",
    appHref: "/image-to-pdf",
    metaTitle: "Convertir une image en PDF (JPG, PNG, WebP) | GigaPDF",
    metaDescription:
      "Convertissez vos images JPG, PNG, WebP, GIF et AVIF en PDF : une ou plusieurs images réunies en un PDF multipage. Gratuit et open source.",
    h1: "Convertir des images en PDF, une ou plusieurs par document",
    intro: [
      "Une image n'est pas un document : un JPG ou un PNG se prête mal à l'envoi formel, à l'archivage ou à l'impression cadrée, et un lot de photos de pages reste un dossier éparpillé tant qu'il n'a pas été relié. Le PDF leur donne un cadre — un fichier unique, ordonné, paginé, qui circule et s'imprime proprement.",
      "GigaPDF convertit vos images en PDF côté serveur : les formats JPG, PNG, WebP, GIF et AVIF sont pris en charge. Une seule image devient un PDF d'une page ; plusieurs images sélectionnées ensemble forment un PDF multipage, dans l'ordre que vous fixez — idéal pour relier les photos successives d'un document numérisé au téléphone. Chaque image est placée sur sa page, à sa résolution d'origine, sans recompression destructrice.",
      "Le PDF produit rejoint votre espace : taggable, cherchable une fois passé à l'OCR, partageable par lien. La conversion est incluse dans le plan gratuit, sans filigrane, et fonctionne sur une instance auto-hébergée pour qui veut garder ses images sur sa propre infrastructure. C'est aussi le complément naturel de la fusion universelle, qui mêle images et autres formats dans un même document.",
    ],
    howTo: {
      title: "Comment convertir une ou plusieurs images en PDF",
      steps: [
        "Importez vos images (JPG, PNG, WebP, GIF, AVIF) dans votre espace GigaPDF.",
        "Sélectionnez une seule image, ou plusieurs pour un document multipage.",
        "Définissez l'ordre des images si vous en réunissez plusieurs.",
        "Lancez la conversion : chaque image est placée sur sa page à sa résolution d'origine.",
        "Téléchargez le PDF, passez-le à l'OCR pour le rendre cherchable, ou partagez-le par lien.",
      ],
    },
    capabilities: [
      "Conversion des formats JPG, PNG, WebP, GIF et AVIF en PDF",
      "Une image en PDF d'une page, ou plusieurs en un PDF multipage",
      "Ordre des images défini librement avant la conversion",
      "Images placées à leur résolution d'origine, sans recompression destructrice",
      "Enchaînement avec l'OCR pour rendre le document cherchable",
      "Aucun filigrane ajouté, résultat classé dans la GED",
    ],
    faq: [
      {
        question: "Puis-je réunir plusieurs images dans un seul PDF ?",
        answer:
          "Oui : sélectionnez toutes les images concernées, fixez leur ordre, et GigaPDF génère un PDF où chaque image occupe une page, dans la séquence choisie. C'est la façon la plus simple de relier les photos successives d'un document scanné au téléphone en un fichier unique et ordonné.",
      },
      {
        question: "Quels formats d'image sont acceptés ?",
        answer:
          "Les formats courants du web et de la photo : JPG, PNG, WebP, GIF et AVIF. Vous pouvez mélanger plusieurs de ces formats dans une même conversion — GigaPDF les place tous sur leurs pages respectives dans le PDF final.",
      },
      {
        question: "La qualité de mes images est-elle dégradée ?",
        answer:
          "Non : chaque image est intégrée à sa résolution d'origine, sans recompression destructrice. Si le PDF obtenu est volumineux — beaucoup de photos haute définition —, l'outil de compression de GigaPDF s'applique ensuite, en option, pour l'alléger.",
      },
      {
        question: "Le texte de mes photos de documents deviendra-t-il cherchable ?",
        answer:
          "Pas directement : une image reste une image dans le PDF. Mais en enchaînant l'OCR maison de GigaPDF, le texte des pages est reconnu et un calque cherchable peut être ajouté — le document garde son apparence de photo tout en devenant interrogeable et sélectionnable.",
      },
    ],
    useCases: [
      "Relier les photos successives d'un document numérisé au téléphone en un PDF ordonné",
      "Transformer un justificatif ou un ticket photographié en pièce PDF transmissible",
      "Préparer un lot d'images au format PDF avant de les fusionner avec d'autres documents",
    ],
    relatedTools: ["pdf-vers-image", "fusion-universelle", "compresser-pdf"],
    relatedSolutions: ["immobilier", "experts-comptables", "freelances"],
    icon: "image",
  },
  {
    slug: "pdf-vers-image",
    name: "PDF vers image",
    category: "convert",
    appHref: "/pdf-to-image",
    metaTitle: "Convertir un PDF en image (PNG, JPG) | GigaPDF",
    metaDescription:
      "Exportez chaque page d'un PDF en image PNG ou JPG : vignettes, illustrations, aperçus. Conversion gratuite, open source, sans filigrane.",
    h1: "Convertir un PDF en images PNG ou JPG, page par page",
    intro: [
      "Un PDF ne s'insère pas partout : une page de document qu'on veut glisser dans une présentation, illustrer sur un site, joindre à un message dans une messagerie qui n'affiche pas les PDF en aperçu, ou utiliser comme vignette a souvent besoin de devenir une image. L'export PDF vers image répond à ce besoin en transformant chaque page en fichier PNG ou JPG autonome.",
      "GigaPDF rend chaque page du PDF en image côté serveur : vous choisissez le format de sortie — PNG pour une qualité sans perte et la transparence, JPG pour des fichiers plus légers — et le moteur produit une image par page, fidèle à l'affichage du document. Texte vectoriel, illustrations et mises en page sont rastérisés proprement, à une résolution adaptée à l'usage.",
      "Les images obtenues s'utilisent partout : insertion dans un diaporama, publication en ligne, partage rapide. La conversion est incluse dans le plan gratuit, sans filigrane, et le chemin inverse — image vers PDF — existe aussi dans GigaPDF pour reconstituer un PDF à partir d'images. L'ensemble fonctionne sur une instance auto-hébergée.",
    ],
    howTo: {
      title: "Comment convertir un PDF en images",
      steps: [
        "Importez le PDF à exporter dans votre espace GigaPDF.",
        "Lancez l'export en image depuis le menu de conversion.",
        "Choisissez le format de sortie : PNG (sans perte, transparence) ou JPG (plus léger).",
        "Le moteur rend chaque page en une image fidèle à l'affichage du document.",
        "Récupérez les images produites, page par page, prêtes à être insérées ou partagées.",
      ],
    },
    capabilities: [
      "Export de chaque page du PDF en image autonome",
      "Choix du format de sortie : PNG (sans perte, transparence) ou JPG (plus léger)",
      "Rendu fidèle du texte, des illustrations et de la mise en page",
      "Résolution adaptée à l'usage : aperçu, insertion ou publication",
      "Conversion inverse disponible : image vers PDF dans la même plateforme",
      "Aucun filigrane ajouté sur les images produites",
    ],
    faq: [
      {
        question: "Chaque page devient-elle une image séparée ?",
        answer:
          "Oui : GigaPDF rend une image par page du PDF. Un document de cinq pages produit cinq fichiers image, ce qui vous laisse choisir précisément lesquels insérer ou partager. Vous récupérez les pages dont vous avez besoin, individuellement.",
      },
      {
        question: "PNG ou JPG : lequel choisir ?",
        answer:
          "PNG offre une qualité sans perte et gère la transparence — c'est le choix pour un rendu net du texte et des aplats, au prix de fichiers plus lourds. JPG produit des images plus légères, bien adaptées aux photos et aux pages riches en images, avec une compression visuellement discrète. Le bon format dépend de votre usage final.",
      },
      {
        question: "Le rendu est-il fidèle au PDF d'origine ?",
        answer:
          "Oui : le moteur rastérise chaque page telle qu'elle s'affiche — texte, vecteurs, images et mise en page à leur place. L'image obtenue correspond à ce que montre une visionneuse PDF, à la résolution choisie.",
      },
      {
        question: "Puis-je refaire un PDF à partir d'images ?",
        answer:
          "Oui, c'est l'opération inverse, également disponible dans GigaPDF : l'outil image vers PDF réunit une ou plusieurs images en un PDF, d'une ou plusieurs pages. Vous pouvez ainsi exporter des pages en images, les retoucher, puis reconstituer un PDF.",
      },
    ],
    useCases: [
      "Insérer une page de PDF comme illustration dans une présentation ou un site",
      "Produire des vignettes ou des aperçus d'un document pour le web",
      "Partager rapidement une page sous forme d'image dans une messagerie sans aperçu PDF",
    ],
    relatedTools: ["image-vers-pdf", "compresser-pdf", "diviser-pdf"],
    relatedSolutions: ["freelances", "enseignants-formateurs", "architectes-btp"],
    icon: "images",
  },
  {
    slug: "pdf-vers-powerpoint",
    name: "PDF vers PowerPoint",
    category: "convert",
    appHref: "/pdf-to-powerpoint",
    metaTitle: "Convertir un PDF en PowerPoint (PPTX) | GigaPDF",
    metaDescription:
      "Transformez un PDF en présentation PowerPoint modifiable (.pptx), une slide par page. Conversion gratuite, open source, sans filigrane.",
    h1: "Convertir un PDF en présentation PowerPoint modifiable",
    intro: [
      "Reprendre un support de présentation dont le fichier source a disparu est un casse-tête courant : il ne reste que le PDF, figé, alors qu'il faudrait actualiser un chiffre, remplacer une diapositive ou repartir d'une trame existante. La conversion PDF vers PPTX reconstruit la présentation dans un format où chaque page redevient une diapositive éditable.",
      "GigaPDF analyse le PDF page par page et génère un fichier .pptx ouvert par PowerPoint ou votre logiciel de présentation : chaque page du document devient une diapositive, ses textes et ses images repris comme éléments manipulables. Vous retrouvez un support sur lequel travailler — déplacer un bloc, corriger un libellé, ajouter une slide — au lieu d'une suite d'images figées. La conversion s'exécute côté serveur, sans installation.",
      "C'est le complément exact de l'outil PowerPoint vers PDF : les deux sens de conversion sont inclus dans le plan gratuit, sans filigrane. Le .pptx produit rejoint votre GED, où il peut être classé, partagé ou reconverti, et toute la chaîne fonctionne sur une instance auto-hébergée pour les organisations qui gardent leurs supports en interne.",
    ],
    howTo: {
      title: "Comment convertir un PDF en PowerPoint",
      steps: [
        "Importez le PDF à convertir dans votre espace GigaPDF.",
        "Choisissez l'export au format PPTX dans le menu de conversion.",
        "Le moteur reconstruit chaque page en une diapositive avec ses textes et images.",
        "Téléchargez le .pptx et ouvrez-le dans PowerPoint ou votre logiciel de présentation.",
        "Reprenez la présentation : déplacez les blocs, corrigez les libellés, ajoutez des diapositives.",
      ],
    },
    capabilities: [
      "Export PPTX compatible PowerPoint et logiciels de présentation",
      "Une page de PDF = une diapositive éditable",
      "Textes et images repris comme éléments manipulables",
      "Conversion côté serveur, sans installation locale",
      "Complément de l'outil PowerPoint vers PDF : conversion dans les deux sens",
      "Aucun filigrane ajouté sur la présentation convertie",
    ],
    faq: [
      {
        question: "Chaque page du PDF devient-elle une diapositive ?",
        answer:
          "Oui : la conversion fait correspondre une page du PDF à une diapositive du .pptx. Un document de douze pages produit une présentation de douze diapositives, dont les textes et images sont repris comme éléments éditables dans PowerPoint.",
      },
      {
        question: "Le résultat est-il vraiment modifiable, ou juste une image par slide ?",
        answer:
          "L'objectif est la réelle éditabilité : les textes détectés reviennent comme blocs de texte et les images comme éléments distincts, manipulables. Les mises en page très graphiques peuvent demander des ajustements après conversion, mais vous obtenez bien un support sur lequel travailler, pas une suite d'images figées.",
      },
      {
        question: "Quand utiliser cette conversion plutôt que l'édition directe ?",
        answer:
          "Quand vous voulez retravailler le support dans votre logiciel de présentation habituel — réorganiser les diapositives, appliquer un thème, réutiliser des éléments. Pour une retouche ponctuelle sur le PDF lui-même (corriger une date, masquer une mention), l'éditeur PDF de GigaPDF est plus direct.",
      },
      {
        question: "Y a-t-il un filigrane sur la présentation convertie ?",
        answer:
          "Aucun. La conversion PDF vers PPTX est une fonction complète du plan gratuit, sans filigrane ni dégradation. Le fichier produit vous appartient, prêt à être édité et présenté.",
      },
    ],
    useCases: [
      "Reprendre un support de formation ou de conférence dont le fichier PowerPoint d'origine a été perdu",
      "Actualiser une présentation client diffusée uniquement en PDF",
      "Réutiliser les diapositives d'un PDF comme base d'un nouveau support",
    ],
    relatedTools: ["powerpoint-vers-pdf", "pdf-vers-word", "fusionner-pdf"],
    relatedSolutions: ["enseignants-formateurs", "freelances", "associations"],
    icon: "presentation",
  },
  {
    slug: "pdf-vers-excel",
    name: "PDF vers Excel",
    category: "convert",
    appHref: "/pdf-to-excel",
    metaTitle: "Convertir un PDF en Excel (XLSX) | GigaPDF",
    metaDescription:
      "Extrayez les tableaux d'un PDF vers un classeur Excel modifiable (.xlsx). Reconstruction des tableaux, gratuit et open source.",
    h1: "Convertir un PDF en classeur Excel modifiable",
    intro: [
      "Récupérer dans un tableur les chiffres figés d'un PDF — un relevé, un export de comptabilité, un tableau de bord reçu sans son fichier source — est l'une des manipulations les plus pénibles : ressaisir cellule par cellule, ou copier-coller un bloc qui s'écrase dans une seule colonne. La conversion PDF vers XLSX reconstruit les tableaux du document dans un classeur où chaque valeur retrouve sa cellule.",
      "GigaPDF analyse la structure tabulaire du PDF et génère un fichier .xlsx ouvert par Excel, votre tableur ou Google Sheets : les lignes et les colonnes détectées sont restituées en cellules, prêtes à être triées, filtrées ou recalculées. Le travail de reconstruction vise à respecter l'organisation du tableau d'origine plutôt que de déverser le texte en vrac. Le traitement s'effectue en ligne, sans logiciel à installer.",
      "Un cas mérite attention : les PDF scannés, dépourvus de texte numérique. Passez d'abord le document à l'OCR multilingue de GigaPDF, puis convertissez — la chaîne scan → OCR → XLSX rend exploitable un tableau numérisé. La conversion est incluse dans le plan gratuit, sans filigrane, et fonctionne en auto-hébergement.",
    ],
    howTo: {
      title: "Comment convertir un PDF en Excel",
      steps: [
        "Importez le PDF contenant les tableaux dans votre espace GigaPDF.",
        "S'il s'agit d'un scan, lancez d'abord l'OCR pour reconnaître le texte.",
        "Choisissez l'export au format XLSX dans le menu de conversion.",
        "Le moteur reconstruit les lignes et colonnes détectées en cellules.",
        "Téléchargez le .xlsx et ouvrez-le dans Excel, votre tableur ou Google Sheets.",
      ],
    },
    capabilities: [
      "Export XLSX compatible Excel, tableurs et Google Sheets",
      "Reconstruction des tableaux du PDF en lignes et colonnes",
      "Valeurs replacées dans leurs cellules, prêtes à trier, filtrer, recalculer",
      "Chaîne scan → OCR → XLSX pour les tableaux numérisés",
      "Conversion côté serveur, sans installation locale",
      "Aucun filigrane ajouté sur le classeur converti",
    ],
    faq: [
      {
        question: "Les tableaux du PDF redeviennent-ils de vrais tableaux dans Excel ?",
        answer:
          "C'est le but : les structures tabulaires détectées sont restituées en lignes et colonnes, chaque valeur dans sa cellule. Vous retrouvez un classeur sur lequel trier, filtrer et recalculer. Les tableaux très complexes — cellules fusionnées en cascade, tableaux dessinés sans structure régulière — peuvent demander un contrôle et quelques ajustements après conversion.",
      },
      {
        question: "Puis-je convertir un tableau scanné en Excel ?",
        answer:
          "Oui, en deux temps : l'OCR d'abord, la conversion ensuite. Un scan ne contient que des images ; l'OCR maison de GigaPDF en extrait le texte, qui alimente alors la reconstruction du tableau en .xlsx. Sans cette étape, il n'y a aucune donnée numérique à replacer dans les cellules.",
      },
      {
        question: "Que se passe-t-il pour le texte hors tableau ?",
        answer:
          "La conversion privilégie les zones tabulaires du document. Le texte purement narratif d'un PDF se prête mal au format cellule : pour reprendre un document mêlant prose et tableaux, l'export vers Word ou ODT est souvent plus adapté, et l'export XLSX se réserve aux pages réellement tabulaires.",
      },
      {
        question: "Y a-t-il un filigrane sur le classeur produit ?",
        answer:
          "Aucun. La conversion PDF vers XLSX est incluse dans le plan gratuit sans filigrane ni dégradation. Le fichier produit vous appartient, prêt à être retravaillé dans votre tableur.",
      },
    ],
    useCases: [
      "Récupérer les chiffres d'un relevé ou d'un export comptable reçu sans son fichier source",
      "Reprendre un tableau de bord PDF dans un tableur pour le trier et le recalculer",
      "Convertir un tableau scanné en classeur exploitable via OCR puis conversion",
    ],
    relatedTools: ["excel-vers-pdf", "pdf-vers-word", "pdf-vers-powerpoint"],
    relatedSolutions: ["experts-comptables", "freelances", "associations"],
    icon: "table",
  },
  {
    slug: "rtf-pdf",
    name: "RTF et PDF",
    category: "convert",
    appHref: "/rtf-pdf",
    metaTitle: "Convertir RTF en PDF et PDF en RTF | GigaPDF",
    metaDescription:
      "Convertissez vos fichiers RTF en PDF, et repassez du PDF vers le RTF modifiable. Le pont RTF ↔ PDF, gratuit et open source.",
    h1: "RTF vers PDF, et retour : le format texte universel",
    intro: [
      "Le RTF (Rich Text Format) est le format texte d'échange le plus universel : lisible par tous les traitements de texte, indépendant de l'éditeur, il sert encore de pivot dans bien des chaînes documentaires et des exports d'applications anciennes. Mais pour figer ou diffuser un .rtf, le PDF reste la référence — et inversement, reprendre le contenu d'un PDF dans un format texte simple passe naturellement par le RTF.",
      "GigaPDF assure les deux sens avec son moteur de conversion maison côté serveur. Le RTF se convertit en PDF en préservant la mise en forme du texte — styles, paragraphes, attributs de caractères —, dans un document figé prêt à transmettre. Et un PDF s'exporte en RTF pour récupérer son texte dans un format ouvert que tout traitement de texte rouvre et retravaille, sans dépendance à une suite particulière.",
      "Cette bidirectionnalité fait du RTF un format de transit commode entre le monde figé du PDF et celui des traitements de texte. La conversion est incluse dans le plan gratuit, sans filigrane, et s'exécute sur une instance auto-hébergée. Pour les documents scannés, l'OCR maison fournit d'abord le texte avant l'export RTF.",
    ],
    howTo: {
      title: "Comment convertir entre RTF et PDF",
      steps: [
        "Importez votre fichier .rtf — ou le PDF à reprendre — dans votre espace GigaPDF.",
        "Pour figer un RTF, lancez la conversion en PDF : la mise en forme du texte est préservée.",
        "Pour le sens inverse, ouvrez un PDF et exportez-le en RTF.",
        "S'il s'agit d'un PDF scanné, appliquez d'abord l'OCR pour reconnaître le texte.",
        "Ouvrez le RTF dans votre traitement de texte, ou classez le PDF dans la GED.",
      ],
    },
    capabilities: [
      "Conversion du RTF vers PDF avec préservation de la mise en forme du texte",
      "Export inverse du PDF vers RTF pour récupérer le contenu dans un format ouvert",
      "Moteur de conversion maison côté serveur, sans installation",
      "Chaîne scan → OCR → RTF pour les documents numérisés",
      "RTF lisible par tout traitement de texte, sans dépendance à une suite",
      "Aucun filigrane, conversion incluse dans le plan gratuit",
    ],
    faq: [
      {
        question: "Pourquoi passer par le RTF plutôt que le DOCX ?",
        answer:
          "Le RTF est plus universel et plus léger : c'est un format texte ouvert lisible par à peu près tous les traitements de texte, y compris anciens, et utilisé comme pivot par de nombreux outils. Pour un échange de texte simple sans dépendance à une suite précise, il est souvent plus sûr que le .docx. Pour une mise en page riche, GigaPDF propose aussi l'export DOCX.",
      },
      {
        question: "La mise en forme de mon RTF est-elle conservée dans le PDF ?",
        answer:
          "Oui : styles de paragraphes, graisses, italiques, alignements et tailles de caractères sont restitués dans le PDF. Le RTF décrivant une mise en forme plus simple que le PDF, la conversion est généralement très fidèle sur les documents textuels.",
      },
      {
        question: "Puis-je convertir un PDF scanné en RTF ?",
        answer:
          "Oui, en chaînant deux outils : l'OCR maison de GigaPDF reconnaît d'abord le texte du scan, puis l'export RTF le structure dans un fichier texte modifiable. Sans l'étape OCR, un scan n'a pas de texte à exporter.",
      },
      {
        question: "Le RTF produit s'ouvre-t-il dans n'importe quel logiciel ?",
        answer:
          "Oui : le RTF est un format standard ouvert que tous les traitements de texte courants — Word, les suites OpenDocument, les éditeurs légers — savent ouvrir et réenregistrer. Vous n'êtes enfermé dans aucun éditeur particulier.",
      },
    ],
    useCases: [
      "Figer un document RTF en PDF avant transmission, mise en forme préservée",
      "Récupérer le texte d'un PDF dans un format ouvert rouvrable partout",
      "Reprendre le contenu d'un courrier scanné en RTF via l'OCR intégré",
    ],
    relatedTools: ["texte-vers-pdf", "word-vers-pdf", "pdf-vers-word"],
    relatedSolutions: ["associations", "freelances", "education-etudiants"],
    icon: "file-text",
  },
  {
    slug: "texte-vers-pdf",
    name: "Texte vers PDF",
    category: "convert",
    appHref: "/text-to-pdf",
    metaTitle: "Convertir un fichier texte (.txt) en PDF | GigaPDF",
    metaDescription:
      "Transformez un fichier texte brut (.txt) en PDF propre et lisible, pagination soignée. Conversion gratuite, open source, sans filigrane.",
    h1: "Convertir un fichier texte (.txt) en PDF propre",
    intro: [
      "Un fichier texte brut (.txt) est universel mais ingrat à diffuser : pas de mise en page, un rendu qui varie selon l'éditeur et l'encodage, des retours à la ligne aléatoires d'un logiciel à l'autre. Logs, notes, exports de données, contenus copiés depuis une console : ces fichiers utiles gagnent à être figés en PDF lisible avant d'être transmis, imprimés ou archivés.",
      "GigaPDF convertit un .txt en PDF côté serveur : le texte est mis en page proprement, paginé et rendu dans un document à l'apparence stable, identique sur tous les écrans. L'encodage est respecté — accents et caractères spéciaux du français sont correctement restitués —, et le résultat est un PDF net, prêt à être classé ou partagé, là où le fichier texte d'origine restait un brouillon technique.",
      "L'outil est disponible dans le plan gratuit, sans filigrane, hébergé en propre. Le PDF produit rejoint votre GED comme n'importe quel document, et s'enchaîne avec les autres outils — fusion, protection, archivage PDF/A. Pour un texte enrichi avec mise en forme, l'outil RTF vers PDF prend le relais ; pour une mise en page complexe, le HTML vers PDF.",
    ],
    howTo: {
      title: "Comment convertir un fichier texte en PDF",
      steps: [
        "Importez votre fichier .txt dans votre espace GigaPDF.",
        "Lancez la conversion en PDF depuis le menu d'actions.",
        "Le moteur met le texte en page et le pagine proprement, encodage respecté.",
        "Contrôlez le rendu dans la visionneuse intégrée.",
        "Téléchargez le PDF, partagez-le par lien ou classez-le dans la GED.",
      ],
    },
    capabilities: [
      "Conversion d'un fichier texte brut (.txt) en PDF propre et paginé",
      "Mise en page stable, identique sur tous les écrans",
      "Encodage respecté : accents et caractères spéciaux du français restitués",
      "Conversion côté serveur, sans installation locale",
      "Enchaînement avec la fusion, la protection et l'archivage PDF/A",
      "Aucun filigrane ajouté sur le document produit",
    ],
    faq: [
      {
        question: "Mes accents et caractères spéciaux seront-ils corrects ?",
        answer:
          "Oui : la conversion respecte l'encodage du fichier, si bien que les accents, cédilles et caractères spéciaux du français sont restitués fidèlement dans le PDF. Le rendu est stable, contrairement à l'ouverture d'un .txt qui dépend de l'éditeur et de ses réglages d'encodage.",
      },
      {
        question: "Puis-je convertir un texte avec une mise en forme (gras, titres) ?",
        answer:
          "Un fichier .txt ne contient, par définition, aucune mise en forme — seulement du texte brut. Si votre contenu comporte des styles, partez plutôt d'un fichier RTF (outil RTF vers PDF) ou d'un gabarit HTML (outil HTML vers PDF) : ces formats portent la mise en forme que le .txt ne peut pas exprimer.",
      },
      {
        question: "La pagination est-elle gérée pour les longs fichiers ?",
        answer:
          "Oui : le texte est réparti sur autant de pages que nécessaire, avec une pagination propre. Un long fichier de logs ou de notes devient un PDF multipage lisible, plutôt qu'un bloc de texte ininterrompu.",
      },
      {
        question: "Y a-t-il un filigrane sur le PDF produit ?",
        answer:
          "Aucun. La conversion texte vers PDF est une fonction complète du plan gratuit, sans filigrane. Le fichier produit vous appartient, propre et prêt à diffuser.",
      },
    ],
    useCases: [
      "Figer un fichier de logs ou de notes en PDF lisible avant transmission",
      "Transformer un export de données texte en document propre et paginé",
      "Archiver proprement un contenu copié depuis une console ou un terminal",
    ],
    relatedTools: ["rtf-pdf", "html-vers-pdf", "word-vers-pdf"],
    relatedSolutions: ["education-etudiants", "freelances", "associations"],
    icon: "file-type",
  },
  {
    slug: "caviarder-pdf",
    appHref: "/documents",
    name: "Caviarder un PDF",
    category: "edit",
    metaTitle: "Caviarder un PDF : caviardage permanent | GigaPDF",
    metaDescription:
      "Caviardez vos PDF pour de bon : le contenu sous la zone est réellement supprimé du fichier, pas masqué d'un rectangle noir. Gratuit, open source.",
    h1: "Caviarder un PDF : une suppression réelle, pas un rectangle noir",
    intro: [
      "Le piège du caviardage est documenté et récurrent : un rectangle noir posé par-dessus un nom, un montant ou une clause, dont le texte réapparaît au premier copier-coller ou à la première extraction. La plupart des outils dessinent un masque sans toucher au contenu situé dessous — la donnée sensible est toujours là, dans le fichier, accessible à qui sait la chercher. Pour un document confidentiel, c'est une fuite en un clic.",
      "GigaPDF applique un caviardage réel : les opérateurs de texte situés dans la zone caviardée sont physiquement retirés du flux de contenu du fichier, et non recouverts. Après traitement, le texte n'existe plus — ni au copier-coller, ni à l'extraction, ni à la recherche. La zone est ensuite recouverte visuellement, mais c'est la suppression sous-jacente qui fait la sécurité : il n'y a plus rien à révéler. La vérification est simple — tentez de sélectionner ou de rechercher un mot occulté, il ne ressort pas.",
      "Cette redaction conforme est portée par le moteur PDF maison de GigaPDF. Elle s'adresse en priorité aux professions qui manient des pièces sensibles — juristes, RH, santé — et tout dossier soumis à un devoir de confidentialité. La fonction est incluse dans le plan gratuit, l'original reste conservé dans l'historique, et toute la chaîne s'opère en auto-hébergement pour ne jamais sortir le document de votre infrastructure.",
    ],
    howTo: {
      title: "Comment caviarder un PDF de façon permanente",
      steps: [
        "Importez le document à caviarder dans votre espace GigaPDF.",
        "Ouvrez-le dans l'éditeur et tracez les zones à occulter sur les passages sensibles.",
        "Appliquez le caviardage : le moteur maison retire le texte sous la zone du flux de contenu.",
        "Vérifiez l'efficacité en tentant un copier-coller ou une recherche sur un mot occulté — rien ne ressort.",
        "Téléchargez le PDF caviardé ; l'original intact reste disponible dans l'historique de versions.",
      ],
    },
    capabilities: [
      "Caviardage réel : le contenu sous la zone est supprimé du fichier, pas masqué",
      "Opérateurs de texte retirés du flux de contenu par le moteur PDF maison",
      "Aucune réapparition au copier-coller, à l'extraction ou à la recherche",
      "Vérification immédiate par tentative de sélection sur une zone occultée",
      "Original conservé dans l'historique de versions",
      "Chaîne entièrement auto-hébergeable pour les documents confidentiels",
    ],
    faq: [
      {
        question: "En quoi est-ce différent d'un rectangle noir posé sur le texte ?",
        answer:
          "Un rectangle noir n'est qu'un dessin par-dessus : le texte reste intact dans le fichier, et un copier-coller, une extraction ou une recherche le révèlent. Le caviardage de GigaPDF retire physiquement les opérateurs de texte du flux de contenu — la donnée n'existe plus dans le document. La zone est recouverte, mais c'est la suppression sous-jacente qui protège.",
      },
      {
        question: "Comment vérifier que le contenu a réellement disparu ?",
        answer:
          "Faites le test qui piège les mauvais outils : sélectionnez la zone caviardée et tentez un copier-coller, ou lancez une recherche sur un mot occulté. Avec le caviardage réel de GigaPDF, rien ne ressort — les opérateurs de texte ont été supprimés, le mot n'est plus dans le fichier.",
      },
      {
        question: "Puis-je revenir en arrière après avoir caviardé ?",
        answer:
          "Oui sur l'original, non sur la donnée caviardée — et c'est voulu. Le caviardage produit une nouvelle version dont le contenu est réellement supprimé ; l'historique conserve la version d'origine, complète, que vous pouvez restaurer. La copie diffusée, elle, ne contient plus rien à révéler.",
      },
      {
        question: "Le caviardage couvre-t-il aussi les images et les métadonnées de la zone ?",
        answer:
          "Le caviardage agit sur le contenu situé dans la zone tracée, texte en premier lieu. Pour un document particulièrement sensible, combinez-le avec les autres garde-fous de GigaPDF : chiffrement AES pour la diffusion et signature numérique qui révèle toute altération ultérieure du fichier.",
      },
    ],
    useCases: [
      "Occulter définitivement un nom ou un montant dans une pièce avant communication",
      "Caviarder des données personnelles d'un document soumis à confidentialité",
      "Préparer une version publique d'un dossier en supprimant réellement les passages sensibles",
    ],
    relatedTools: ["annoter-pdf", "proteger-pdf", "filigrane-pdf"],
    relatedSolutions: ["avocats", "ressources-humaines", "sante"],
    icon: "square-pen",
  },
  {
    slug: "deverrouiller-pdf",
    name: "Déverrouiller un PDF",
    category: "secure",
    appHref: "/unlock",
    metaTitle: "Déverrouiller un PDF : retirer le mot de passe | GigaPDF",
    metaDescription:
      "Retirez le mot de passe d'un PDF que vous connaissez : déchiffrement et suppression de la protection. Gratuit, open source, auto-hébergeable.",
    h1: "Déverrouiller un PDF : retirer un mot de passe que vous connaissez",
    intro: [
      "Un PDF chiffré rend service tant qu'il circule, mais devient encombrant une fois arrivé à bon port : ressaisir le mot de passe à chaque ouverture, se heurter au refus d'impression ou de copie, ne pas pouvoir l'indexer ni le retravailler. Quand vous détenez légitimement le mot de passe, retirer la protection rend le document à nouveau pratique au quotidien.",
      "GigaPDF déchiffre le fichier à partir du mot de passe que vous fournissez et produit une version déverrouillée, lisible et manipulable sans contrainte. L'opération suppose une condition stricte et non négociable : connaître le mot de passe. GigaPDF ne casse aucun chiffrement et ne contourne aucune protection — c'est un outil de déchiffrement légitime pour vos propres documents ou ceux que vous êtes autorisé à ouvrir, pas un outil de forçage.",
      "Une fois déverrouillé, le document s'édite, se fusionne, s'indexe et se rechiffre au besoin avec un nouveau mot de passe. La fonction est incluse dans le plan gratuit, et toute la chaîne s'opère en auto-hébergement pour les documents qui ne doivent pas quitter votre infrastructure. C'est l'opération complémentaire de la protection par mot de passe.",
    ],
    howTo: {
      title: "Comment retirer le mot de passe d'un PDF",
      steps: [
        "Importez le PDF protégé dans votre espace GigaPDF.",
        "Ouvrez l'outil de déverrouillage et saisissez le mot de passe du document.",
        "Validez : GigaPDF déchiffre le fichier à partir du mot de passe fourni.",
        "Récupérez la version déverrouillée, lisible et manipulable sans contrainte.",
        "Rechiffrez-la si besoin avec un nouveau mot de passe, ou classez-la dans la GED.",
      ],
    },
    capabilities: [
      "Déchiffrement d'un PDF à partir du mot de passe que vous fournissez",
      "Suppression de la protection : plus de saisie de mot de passe à l'ouverture",
      "Levée des restrictions d'impression et de copie une fois le document déchiffré",
      "Rechiffrement possible ensuite avec un nouveau mot de passe",
      "Aucun contournement de protection : le mot de passe est requis",
      "Chaîne entièrement auto-hébergeable pour les documents sensibles",
    ],
    faq: [
      {
        question: "Faut-il connaître le mot de passe pour déverrouiller le PDF ?",
        answer:
          "Oui, c'est une condition stricte et non négociable. GigaPDF déchiffre le document à partir du mot de passe que vous fournissez ; il ne casse aucun chiffrement et ne contourne aucune protection. C'est un outil légitime pour vos propres fichiers ou ceux que vous êtes autorisé à ouvrir, pas un outil de forçage.",
      },
      {
        question: "GigaPDF peut-il déverrouiller un PDF dont j'ai perdu le mot de passe ?",
        answer:
          "Non, et c'est précisément ce qui fait la valeur du chiffrement : il n'existe pas de porte dérobée. Sans le mot de passe d'ouverture, un PDF chiffré en AES-256 est cryptographiquement illisible. Si le fichier d'origine non chiffré est encore dans votre espace, l'historique de versions peut vous permettre de le récupérer.",
      },
      {
        question: "Le document déverrouillé peut-il être rechiffré ensuite ?",
        answer:
          "Oui : une fois la protection retirée, vous pouvez retravailler le document puis le rechiffrer avec un nouveau mot de passe via l'outil de protection de GigaPDF. C'est utile pour changer un mot de passe : déverrouiller avec l'ancien, rechiffrer avec le nouveau.",
      },
      {
        question: "Quelle différence entre déverrouiller et lever les restrictions d'impression ?",
        answer:
          "Un PDF peut porter deux verrous : un mot de passe d'ouverture (lecture) et un mot de passe propriétaire (droits d'impression, copie). Le déverrouillage à partir du mot de passe que vous détenez retire la protection et rend le document librement lisible et manipulable, restrictions comprises.",
      },
    ],
    useCases: [
      "Retirer le mot de passe d'un document chiffré une fois qu'il n'a plus besoin de circuler protégé",
      "Changer le mot de passe d'un PDF : déverrouiller avec l'ancien, rechiffrer avec le nouveau",
      "Rendre indexable et éditable un PDF protégé dont vous détenez le mot de passe",
    ],
    relatedTools: ["proteger-pdf", "signer-pdf", "caviarder-pdf"],
    relatedSolutions: ["ressources-humaines", "experts-comptables", "avocats"],
    icon: "unlock",
  },
  {
    slug: "markdown-vers-pdf",
    name: "Markdown vers PDF",
    category: "convert",
    appHref: "/markdown-to-pdf",
    metaTitle: "Convertir un fichier Markdown (.md) en PDF | GigaPDF",
    metaDescription:
      "Transformez vos fichiers Markdown (.md) en PDF mis en page : titres, listes, tableaux, code et liens rendus proprement. Gratuit et open source.",
    h1: "Convertir un fichier Markdown (.md) en PDF mis en page",
    intro: [
      "Le Markdown est le format des notes, des README, de la documentation et des contenus rédigés en clair. Parfait à écrire, il reste illisible à diffuser tel quel : un fichier .md brut affiche ses dièses, ses astérisques et ses barres de tableau. Pour partager, imprimer ou archiver, il faut un PDF qui rende la mise en forme — titres hiérarchisés, listes, tableaux, blocs de code et liens.",
      "GigaPDF convertit un Markdown en PDF côté serveur, avec son moteur de mise en page maison : la syntaxe CommonMark et les tableaux GFM sont interprétés et rendus dans un document propre et paginé. Le résultat est un PDF fidèle, prêt à classer dans votre GED ou à enchaîner avec la fusion, la protection ou l'archivage PDF/A — sans filigrane, dans le plan gratuit.",
    ],
    howTo: {
      title: "Comment convertir un Markdown en PDF",
      steps: [
        "Importez votre fichier .md dans votre espace GigaPDF.",
        "Lancez la conversion en PDF depuis le menu d'actions.",
        "Le moteur interprète la syntaxe Markdown (titres, listes, tableaux, code) et la met en page.",
        "Contrôlez le rendu dans la visionneuse intégrée.",
        "Téléchargez le PDF, partagez-le par lien ou classez-le dans la GED.",
      ],
    },
    capabilities: [
      "Rendu de la syntaxe CommonMark : titres, paragraphes, gras, italique, listes, citations",
      "Tableaux Markdown (GFM) convertis en vrais tableaux paginés",
      "Blocs de code et code en ligne rendus en police à chasse fixe",
      "Liens préservés et mise en page stable, identique sur tous les écrans",
      "Conversion côté serveur, sans installation, sans filigrane",
    ],
    faq: [
      {
        question: "Quelle syntaxe Markdown est prise en charge ?",
        answer:
          "Le moteur suit la syntaxe CommonMark — titres, paragraphes, emphase, listes à puces et numérotées, citations, blocs de code, liens — et les tableaux au format GitHub (GFM). Ce sont les éléments du Markdown utilisé au quotidien pour la documentation et les notes.",
      },
      {
        question: "Mes tableaux Markdown seront-ils de vrais tableaux dans le PDF ?",
        answer:
          "Oui : un tableau écrit en barres verticales et tirets est interprété comme une grille et rendu en tableau paginé dans le PDF, avec ses lignes et colonnes — pas une simple ligne de texte avec des barres.",
      },
      {
        question: "Y a-t-il un filigrane sur le PDF produit ?",
        answer:
          "Aucun. La conversion Markdown vers PDF est une fonction complète du plan gratuit, sans filigrane. Le fichier produit vous appartient.",
      },
      {
        question: "Puis-je convertir plusieurs fichiers Markdown d'un coup ?",
        answer:
          "Oui : importez vos fichiers .md dans votre espace et convertissez-les à la suite. Chaque PDF produit rejoint votre GED comme n'importe quel document, prêt à être fusionné, protégé ou archivé en PDF/A.",
      },
    ],
    useCases: [
      "Diffuser une documentation technique rédigée en Markdown sous forme de PDF lisible",
      "Figer un README ou des notes de réunion en document propre et paginé",
      "Archiver un contenu Markdown dans un format stable, indépendant de l'éditeur",
    ],
    relatedTools: ["texte-vers-pdf", "html-vers-pdf", "rtf-pdf"],
    relatedSolutions: ["freelances", "education-etudiants", "associations"],
    icon: "file-input",
  },
  {
    slug: "csv-vers-pdf",
    name: "CSV vers PDF",
    category: "convert",
    appHref: "/csv-to-pdf",
    metaTitle: "Convertir un fichier CSV en PDF (tableau) | GigaPDF",
    metaDescription:
      "Transformez un fichier CSV en PDF : les données sont rendues en tableau propre et paginé, prêt à imprimer ou partager. Gratuit et open source.",
    h1: "Convertir un fichier CSV en PDF sous forme de tableau",
    intro: [
      "Un CSV est parfait pour échanger des données entre logiciels, mais déplorable à lire : ouvert dans un éditeur de texte, ce n'est qu'une suite de valeurs séparées par des virgules ; ouvert dans un tableur, le rendu dépend des réglages de chacun. Pour transmettre un extrait de données, l'imprimer ou l'archiver, un PDF qui présente le tout en tableau net est bien plus parlant.",
      "GigaPDF convertit un CSV en PDF côté serveur : les lignes et colonnes sont reconstruites en un véritable tableau, mis en page et paginé. Le document produit est stable, lisible et prêt à être classé dans votre GED ou enchaîné avec les autres outils — sans filigrane, dans le plan gratuit.",
      "Au-delà de la simple lecture, figer un CSV en PDF garantit que vos chiffres s'affichent partout de la même façon, sans qu'un tableur réinterprète une date ou un grand nombre au passage. Le document produit rejoint votre espace GigaPDF, où il se range, s'étiquette et se retrouve par la recherche plein texte. Comme tout le reste de la plateforme, l'outil est open source et auto-hébergeable : sur votre propre serveur, vos jeux de données ne transitent par aucun service extérieur.",
    ],
    howTo: {
      title: "Comment convertir un CSV en PDF",
      steps: [
        "Importez votre fichier .csv dans votre espace GigaPDF.",
        "Lancez la conversion en PDF depuis le menu d'actions.",
        "Le moteur reconstruit les lignes et colonnes en tableau paginé.",
        "Contrôlez le rendu dans la visionneuse intégrée.",
        "Téléchargez le PDF, partagez-le par lien ou classez-le dans la GED.",
      ],
    },
    capabilities: [
      "Reconstruction des lignes et colonnes du CSV en tableau paginé",
      "Mise en page stable, identique sur tous les écrans",
      "Pagination automatique des grands jeux de données",
      "Conversion côté serveur, sans installation locale",
      "Aucun filigrane ajouté sur le document produit",
    ],
    faq: [
      {
        question: "Les grands fichiers CSV sont-ils paginés ?",
        answer:
          "Oui : un long CSV est réparti sur autant de pages que nécessaire, avec une pagination propre, plutôt qu'un tableau qui déborde. Le document reste lisible quel que soit le nombre de lignes.",
      },
      {
        question: "Le séparateur (virgule, point-virgule) est-il géré ?",
        answer:
          "Le moteur interprète les conventions CSV usuelles pour reconstituer la grille. Le résultat est un tableau structuré, indépendant du séparateur d'origine.",
      },
      {
        question: "Y a-t-il un filigrane sur le PDF produit ?",
        answer:
          "Aucun. La conversion CSV vers PDF fait partie du plan gratuit, sans filigrane. Le fichier produit vous appartient.",
      },
      {
        question: "Le PDF produit rejoint-il ma GED ?",
        answer:
          "Oui : comme tout document produit par GigaPDF, le PDF issu de votre CSV est classé dans votre espace, où il peut être renommé, étiqueté, fusionné avec d'autres fichiers ou archivé en PDF/A.",
      },
    ],
    useCases: [
      "Présenter un export de données en tableau PDF propre et imprimable",
      "Transmettre un extrait de base ou de tableur à des destinataires sans tableur",
      "Archiver un jeu de données dans un format stable et lisible",
    ],
    relatedTools: ["excel-vers-pdf", "texte-vers-pdf", "fusionner-pdf"],
    relatedSolutions: ["experts-comptables", "freelances", "associations"],
    icon: "file-spreadsheet",
  },
  {
    slug: "pdf-vers-markdown",
    name: "PDF vers Markdown",
    category: "convert",
    appHref: "/pdf-to-markdown",
    metaTitle: "Convertir un PDF en Markdown (.md) | GigaPDF",
    metaDescription:
      "Transformez un PDF en Markdown propre : titres, listes, tableaux et liens reconstruits en texte structuré. Gratuit, open source.",
    h1: "Convertir un PDF en Markdown réutilisable",
    intro: [
      "Récupérer le contenu d'un PDF pour le réintégrer dans une documentation, un wiki ou un dépôt Git suppose un format texte structuré, pas un copier-coller qui perd la mise en forme. Le Markdown est ce format pivot : léger, lisible, versionnable, accepté par tous les générateurs de sites et de docs.",
      "GigaPDF reconstruit, à partir du PDF, un Markdown structuré : les titres redeviennent des niveaux de hiérarchie, les listes et tableaux retrouvent leur syntaxe, les liens sont préservés. Le moteur maison analyse la structure du document plutôt que d'aplatir la page, pour produire un .md propre, prêt à éditer et à committer — sans filigrane, dans le plan gratuit.",
      "Cette reconstruction structurée fait gagner un temps précieux à qui maintient une base de connaissances : fini de recopier à la main le contenu d'un PDF dans son wiki ou son dépôt. Le Markdown obtenu se relit, se corrige et se versionne avant publication, dans l'éditeur de votre choix. L'ensemble de la plateforme étant open source et auto-hébergeable, vos documents sensibles se convertissent sur votre propre infrastructure, sans jamais atteindre un service tiers.",
    ],
    howTo: {
      title: "Comment convertir un PDF en Markdown",
      steps: [
        "Importez le PDF dans votre espace GigaPDF.",
        "S'il s'agit d'un scan, appliquez d'abord l'OCR pour reconnaître le texte.",
        "Choisissez l'export au format Markdown dans le menu de conversion.",
        "Le moteur reconstruit titres, listes, tableaux et liens en Markdown.",
        "Téléchargez le .md, prêt à intégrer dans votre documentation ou votre dépôt.",
      ],
    },
    capabilities: [
      "Reconstruction des titres en niveaux de hiérarchie Markdown",
      "Listes, citations et liens préservés dans la syntaxe Markdown",
      "Tableaux du PDF convertis en tableaux Markdown (GFM)",
      "Chaîne scan → OCR maison → Markdown pour les documents numérisés",
      "Aucun filigrane sur le fichier produit",
    ],
    faq: [
      {
        question: "Pourquoi exporter en Markdown plutôt qu'en texte brut ?",
        answer:
          "Le texte brut perd toute structure : titres, listes et tableaux deviennent des paragraphes indistincts. Le Markdown conserve la hiérarchie et la mise en forme dans une syntaxe légère, directement réutilisable dans une documentation, un site statique ou un dépôt Git.",
      },
      {
        question: "Les tableaux sont-ils conservés ?",
        answer:
          "Oui : un tableau détecté dans le PDF est exporté en tableau Markdown (format GitHub), avec ses lignes et colonnes. Un document très graphique peut toutefois demander quelques retouches, comme pour toute conversion depuis PDF.",
      },
      {
        question: "Puis-je convertir un PDF scanné en Markdown ?",
        answer:
          "Oui, en chaînant l'OCR puis l'export Markdown : l'OCR reconnaît d'abord le texte du scan, l'export le structure ensuite en Markdown. Sans l'étape OCR, un scan n'a pas de texte à convertir.",
      },
      {
        question: "Le contenu reste-t-il confidentiel ?",
        answer:
          "Oui : la conversion s'exécute sur notre propre infrastructure, sans service tiers. En auto-hébergement, vos documents ne quittent jamais votre serveur — un point décisif pour les contenus sensibles.",
      },
    ],
    useCases: [
      "Réintégrer le contenu d'un PDF dans une documentation ou un wiki",
      "Versionner dans Git le texte d'un document diffusé en PDF",
      "Alimenter un site statique à partir d'anciens livrables PDF",
    ],
    relatedTools: ["pdf-vers-word", "pdf-vers-odt", "ocr-pdf"],
    relatedSolutions: ["freelances", "education-etudiants", "associations"],
    icon: "file-output",
  },
  {
    slug: "pdf-vers-epub",
    name: "PDF vers EPUB",
    category: "convert",
    appHref: "/pdf-to-epub",
    metaTitle: "Convertir un PDF en EPUB (livre numérique) | GigaPDF",
    metaDescription:
      "Transformez un PDF en EPUB lisible sur liseuse et mobile : texte refluable, chapitres et images repris. Conversion gratuite, open source, sans filigrane.",
    h1: "Convertir un PDF en EPUB pour liseuses et mobiles",
    intro: [
      "Un PDF est figé à la taille de sa page : sur une liseuse ou un téléphone, il oblige à zoomer et à se déplacer, ligne après ligne. L'EPUB est le format des livres numériques : son texte reflue pour s'adapter à l'écran, à la taille de police et au confort de lecture choisis. Convertir un PDF en EPUB, c'est rendre un document réellement lisible en mobilité.",
      "GigaPDF reconstruit, à partir du PDF, un EPUB structuré : le texte redevient du contenu refluable, les chapitres sont reconstitués et les images reprises. Le fichier produit s'ouvre dans toutes les liseuses et applications de lecture compatibles — sans filigrane, dans le plan gratuit.",
    ],
    howTo: {
      title: "Comment convertir un PDF en EPUB",
      steps: [
        "Importez le PDF dans votre espace GigaPDF.",
        "S'il s'agit d'un scan, appliquez d'abord l'OCR pour reconnaître le texte.",
        "Choisissez l'export au format EPUB dans le menu de conversion.",
        "Le moteur reconstruit le texte refluable, les chapitres et les images.",
        "Téléchargez l'EPUB et ouvrez-le sur votre liseuse ou votre application de lecture.",
      ],
    },
    capabilities: [
      "Texte refluable adapté aux liseuses, tablettes et téléphones",
      "Chapitres reconstitués et images reprises depuis le PDF",
      "Fichier EPUB standard, lu par les liseuses et applications compatibles",
      "Chaîne scan → OCR maison → EPUB pour les documents numérisés",
      "Aucun filigrane sur le fichier produit",
    ],
    faq: [
      {
        question: "Pourquoi convertir un PDF en EPUB ?",
        answer:
          "Le texte d'un PDF est fixé à la dimension de la page : sur petit écran, il faut zoomer et faire défiler horizontalement. L'EPUB fait refluer le texte selon l'écran et la taille de police choisie, pour une lecture confortable sur liseuse et mobile.",
      },
      {
        question: "La mise en page d'origine est-elle conservée ?",
        answer:
          "L'EPUB privilégie le confort de lecture à la fidélité de mise en page : le texte reflue et n'est plus figé. Un roman ou un rapport se convertit très bien ; un document très graphique (magazine, plaquette) reste mieux servi par le PDF.",
      },
      {
        question: "Puis-je convertir un PDF scanné en EPUB ?",
        answer:
          "Oui, en chaînant l'OCR puis l'export EPUB : l'OCR reconnaît d'abord le texte du scan, qui devient ensuite du contenu refluable. Sans OCR, un scan n'a pas de texte à reformuler.",
      },
      {
        question: "L'EPUB produit fonctionne-t-il sur toutes les liseuses ?",
        answer:
          "L'export suit le standard EPUB, lu par les liseuses et applications de lecture compatibles. Le texte refluable s'adapte à l'écran et à la taille de police, pour une lecture confortable sur la plupart des appareils.",
      },
    ],
    useCases: [
      "Lire confortablement un long rapport PDF sur une liseuse",
      "Diffuser un livre ou un guide au format des bibliothèques numériques",
      "Convertir d'anciens documents PDF en livres numériques refluables",
    ],
    relatedTools: ["pdf-vers-word", "pdf-vers-markdown", "ocr-pdf"],
    relatedSolutions: ["education-etudiants", "enseignants-formateurs", "associations"],
    icon: "book-open",
  },
  {
    slug: "pdf-vers-rtf",
    name: "PDF vers RTF",
    category: "convert",
    appHref: "/pdf-to-rtf",
    metaTitle: "Convertir un PDF en RTF (texte enrichi) | GigaPDF",
    metaDescription:
      "Transformez un PDF en RTF modifiable, ouvert par tous les traitements de texte, mise en forme reprise. Conversion gratuite, open source, sans filigrane.",
    h1: "Convertir un PDF en RTF modifiable",
    intro: [
      "Le RTF (Rich Text Format) est le format d'échange universel des traitements de texte : ouvert par Word, Writer, TextEdit et la plupart des éditeurs, sans dépendance à une suite particulière. Convertir un PDF en RTF, c'est récupérer un texte enrichi modifiable partout, sans imposer un format propriétaire à ses destinataires.",
      "GigaPDF reconstruit, à partir du PDF, un document RTF : le texte redevient éditable avec sa mise en forme essentielle, prêt à être repris dans n'importe quel traitement de texte. Pour les PDF scannés, l'OCR maison fournit d'abord le texte, la conversion fait le reste — sans filigrane, dans le plan gratuit.",
      "Format pivot par excellence, le RTF traverse les époques et les logiciels : un fichier produit aujourd'hui s'ouvrira encore dans dix ans, sur un éditeur que personne n'a encore imaginé. C'est ce qui en fait un bon choix d'échange quand on ignore quel traitement de texte utilisera le destinataire, ou s'il dispose d'une suite bureautique complète. L'outil reste, comme le reste de GigaPDF, gratuit et hébergeable chez vous, sans rien envoyer vers l'extérieur.",
    ],
    howTo: {
      title: "Comment convertir un PDF en RTF",
      steps: [
        "Importez le PDF dans votre espace GigaPDF.",
        "S'il s'agit d'un scan, appliquez d'abord l'OCR pour reconnaître le texte.",
        "Choisissez l'export au format RTF dans le menu de conversion.",
        "Le moteur reconstruit le texte enrichi modifiable.",
        "Ouvrez le .rtf dans votre traitement de texte et reprenez la rédaction.",
      ],
    },
    capabilities: [
      "Export RTF ouvert par tous les traitements de texte, sans format propriétaire",
      "Texte redevenu éditable avec sa mise en forme essentielle",
      "Chaîne scan → OCR maison → RTF pour les documents numérisés",
      "Compatibilité maximale : Word, Writer, TextEdit et éditeurs simples",
      "Aucun filigrane sur le document converti",
    ],
    faq: [
      {
        question: "Quelle différence entre RTF et DOCX en sortie ?",
        answer:
          "Le DOCX est plus riche mais propre à l'écosystème Word ; le RTF est plus simple et lisible par quasiment tous les éditeurs, y compris très légers. Choisissez le RTF pour la compatibilité maximale, le DOCX pour une mise en forme plus complète.",
      },
      {
        question: "La mise en forme est-elle conservée ?",
        answer:
          "Le texte revient avec ses attributs essentiels — corps, graisse, styles de base. Un document très graphique peut demander des retouches ; un courrier, un rapport ou un contrat se reprend en général directement.",
      },
      {
        question: "Puis-je convertir un scan en RTF ?",
        answer:
          "Oui, en chaînant l'OCR puis l'export RTF : l'OCR reconnaît le texte du scan, l'export le structure en texte enrichi. Sans OCR, un scan n'a pas de texte à convertir.",
      },
      {
        question: "Le contenu reste-t-il confidentiel ?",
        answer:
          "Oui : la conversion s'exécute sur notre propre infrastructure, sans service tiers. En auto-hébergement, vos documents ne quittent jamais votre serveur.",
      },
    ],
    useCases: [
      "Reprendre dans un éditeur léger un texte diffusé en PDF",
      "Échanger un contenu modifiable sans imposer Word à ses destinataires",
      "Convertir des courriers scannés en texte enrichi via l'OCR intégré",
    ],
    relatedTools: ["pdf-vers-word", "pdf-vers-odt", "rtf-pdf"],
    relatedSolutions: ["ressources-humaines", "freelances", "associations"],
    icon: "file-output",
  },
  {
    slug: "pdf-vers-html",
    name: "PDF vers HTML",
    category: "convert",
    appHref: "/pdf-to-html",
    metaTitle: "Convertir un PDF en HTML (page web) | GigaPDF",
    metaDescription:
      "Transformez un PDF en HTML : texte positionné et images reprises pour réutiliser le contenu sur le web. Conversion gratuite, open source, sans filigrane.",
    h1: "Convertir un PDF en HTML pour le web",
    intro: [
      "Republier le contenu d'un PDF sur un site, dans un courriel ou un système de gestion de contenu suppose du HTML, pas un fichier à télécharger. Le HTML rend le texte sélectionnable, indexable par les moteurs de recherche et lisible sur tout écran, là où le PDF reste un document à part.",
      "GigaPDF reconstruit, à partir du PDF, un HTML où le texte est positionné et les images reprises, fidèle à l'agencement de la page. Le moteur maison produit un balisage propre, prêt à être intégré ou retravaillé — sans filigrane, dans le plan gratuit.",
      "Transformer un PDF en page web, c'est aussi le rendre accessible : un contenu HTML se lit avec un lecteur d'écran, s'adapte au téléphone et se traduit à la volée, là où un PDF reste un bloc figé. Le balisage produit sert de point de départ que vous habillez ensuite à votre charte graphique. Et comme toute la plateforme est open source et auto-hébergeable, la conversion tourne entièrement sur votre infrastructure si vous le souhaitez.",
    ],
    howTo: {
      title: "Comment convertir un PDF en HTML",
      steps: [
        "Importez le PDF dans votre espace GigaPDF.",
        "S'il s'agit d'un scan, appliquez d'abord l'OCR pour reconnaître le texte.",
        "Choisissez l'export au format HTML dans le menu de conversion.",
        "Le moteur reconstruit le texte positionné et les images de la page.",
        "Téléchargez le HTML, prêt à intégrer sur votre site ou dans votre CMS.",
      ],
    },
    capabilities: [
      "Texte positionné et images reprises, fidèle à l'agencement de la page",
      "Contenu sélectionnable et indexable, contrairement au PDF",
      "Balisage propre, prêt à intégrer ou à retravailler",
      "Chaîne scan → OCR maison → HTML pour les documents numérisés",
      "Aucun filigrane sur le fichier produit",
    ],
    faq: [
      {
        question: "Le HTML produit est-il directement utilisable sur un site ?",
        answer:
          "Il fournit un contenu structuré, texte et images, que vous intégrez tel quel ou retravaillez selon votre charte. Comme pour toute conversion depuis PDF, une page très graphique peut demander des ajustements de style.",
      },
      {
        question: "Quelle différence avec l'outil HTML vers PDF ?",
        answer:
          "Ce sont les deux sens d'une même chaîne : HTML vers PDF fige une page web en document, PDF vers HTML libère le contenu d'un PDF pour le republier sur le web. Les deux s'appuient sur le moteur HTML maison de GigaPDF.",
      },
      {
        question: "Puis-je convertir un PDF scanné en HTML ?",
        answer:
          "Oui, en chaînant l'OCR puis l'export HTML : l'OCR reconnaît d'abord le texte du scan, l'export le restitue en balisage web. Sans OCR, un scan n'a pas de texte à exporter.",
      },
      {
        question: "Y a-t-il un filigrane sur le résultat ?",
        answer:
          "Aucun. La conversion PDF vers HTML fait partie du plan gratuit, sans filigrane. Le contenu produit vous appartient, prêt à publier.",
      },
    ],
    useCases: [
      "Republier le contenu d'un PDF sur un site ou dans un CMS",
      "Rendre indexable par les moteurs de recherche un document diffusé en PDF",
      "Réutiliser texte et images d'un PDF dans une page web ou un courriel",
    ],
    relatedTools: ["html-vers-pdf", "pdf-vers-markdown", "ocr-pdf"],
    relatedSolutions: ["freelances", "associations", "education-etudiants"],
    icon: "file-output",
  },
  {
    slug: "pdf-vers-texte",
    name: "PDF vers texte",
    category: "convert",
    appHref: "/pdf-to-text",
    metaTitle: "Convertir un PDF en texte (.txt) | GigaPDF",
    metaDescription:
      "Extrayez le texte d'un PDF dans un fichier .txt propre, prêt à réutiliser ou indexer. OCR intégré pour les scans. Gratuit, open source, sans filigrane.",
    h1: "Convertir un PDF en fichier texte (.txt)",
    intro: [
      "Réutiliser le contenu d'un PDF dans un script, une base de données, un moteur de recherche ou un autre logiciel suppose du texte brut, débarrassé de toute mise en page. L'export en .txt extrait ce texte fidèlement, dans l'ordre de lecture, prêt à être traité automatiquement.",
      "GigaPDF extrait le texte d'un PDF côté serveur, dans le respect de l'ordre de lecture et de l'encodage — accents et caractères spéciaux du français inclus. Pour les PDF scannés, l'OCR maison reconnaît d'abord le texte. Le fichier produit est un .txt propre, sans filigrane, dans le plan gratuit.",
      "Réduire un PDF à son texte nu est souvent la première étape d'un traitement automatisé : analyse, classification, alimentation d'un moteur de recherche ou d'un modèle de langage. En se concentrant sur le contenu et l'ordre de lecture, l'export .txt fournit une matière propre, sans le bruit de la mise en page ni des polices. L'opération est gratuite et s'exécute sur notre propre infrastructure ; en auto-hébergement, rien ne sort de chez vous.",
    ],
    howTo: {
      title: "Comment convertir un PDF en texte",
      steps: [
        "Importez le PDF dans votre espace GigaPDF.",
        "S'il s'agit d'un scan, appliquez d'abord l'OCR pour reconnaître le texte.",
        "Choisissez l'export au format texte (.txt) dans le menu de conversion.",
        "Le moteur extrait le texte dans l'ordre de lecture, encodage respecté.",
        "Téléchargez le .txt, prêt à réutiliser, indexer ou traiter automatiquement.",
      ],
    },
    capabilities: [
      "Extraction du texte dans l'ordre de lecture, encodage respecté",
      "Accents et caractères spéciaux du français restitués fidèlement",
      "Chaîne scan → OCR maison → texte pour les documents numérisés",
      "Fichier brut prêt pour le traitement automatique, l'indexation ou la réutilisation",
      "Aucun filigrane ajouté",
    ],
    faq: [
      {
        question: "Le texte sort-il dans le bon ordre ?",
        answer:
          "Oui : le moteur restitue le texte dans l'ordre de lecture du document, pas dans l'ordre arbitraire des objets de la page. Le résultat est exploitable tel quel pour l'indexation ou un traitement automatique.",
      },
      {
        question: "Et si mon PDF est un scan sans texte ?",
        answer:
          "Appliquez d'abord l'OCR : il reconnaît le texte de l'image, qui devient alors extractible en .txt. Sans cette étape, un scan ne contient que des pixels, sans texte à exporter.",
      },
      {
        question: "Les accents sont-ils corrects ?",
        answer:
          "Oui : l'extraction respecte l'encodage, si bien que les accents, cédilles et caractères spéciaux du français sont restitués fidèlement dans le fichier texte.",
      },
      {
        question: "Y a-t-il une limite de taille ?",
        answer:
          "La conversion accepte les documents jusqu'à la limite d'import de votre espace. Un long PDF est extrait en un seul fichier texte, dans l'ordre de lecture, prêt à être traité.",
      },
    ],
    useCases: [
      "Alimenter un script ou une base de données avec le contenu d'un PDF",
      "Indexer le texte d'un document pour la recherche plein texte",
      "Récupérer rapidement le contenu brut d'un PDF pour le réutiliser ailleurs",
    ],
    relatedTools: ["texte-vers-pdf", "ocr-pdf", "pdf-vers-markdown"],
    relatedSolutions: ["experts-comptables", "freelances", "education-etudiants"],
    icon: "file-output",
  },
  {
    slug: "changer-mot-de-passe-pdf",
    name: "Changer le mot de passe d'un PDF",
    category: "secure",
    metaTitle: "Changer le mot de passe d'un PDF | GigaPDF",
    metaDescription:
      "Modifiez ou définissez le mot de passe d'un PDF : ouverture avec l'ancien, ré-chiffrement AES-256 avec le nouveau. Gratuit, moteur PDF maison.",
    h1: "Changer le mot de passe d'un PDF en ligne",
    intro: [
      "Faire tourner le mot de passe d'un contrat confidentiel, révoquer celui qu'un prestataire connaissait, ou simplement protéger un fichier qui ne l'était pas encore : changer le mot de passe d'un PDF ne devrait pas obliger à le déchiffrer dans un outil puis à le rechiffrer dans un autre. GigaPDF réalise les deux en une seule étape.",
      "Quand le document est déjà protégé, vous saisissez son mot de passe actuel — c'est lui qui autorise le changement — puis le nouveau. GigaPDF ouvre le fichier, le rechiffre avec le mot de passe que vous choisissez et conserve les permissions d'origine plutôt que de tout réautoriser à votre insu. Le mot de passe utilisateur (demandé à l'ouverture) et le mot de passe propriétaire (qui régit les permissions) se définissent séparément.",
      "Si le PDF n'avait aucun mot de passe, le même outil lui en pose un : le chiffrement AES-256 du moteur maison s'applique directement, sans dépendance tierce. Tout se passe dans votre espace, le mot de passe ne quitte jamais la requête en cours, et le fichier produit reste lisible par n'importe quel lecteur PDF conforme.",
    ],
    howTo: {
      title: "Comment changer le mot de passe d'un PDF",
      steps: [
        "Importez le PDF dont vous voulez changer ou définir le mot de passe.",
        "Si le fichier est déjà protégé, saisissez son mot de passe actuel.",
        "Indiquez le nouveau mot de passe utilisateur, et au besoin un mot de passe propriétaire distinct.",
        "Choisissez l'algorithme de chiffrement : AES-256 est recommandé.",
        "Lancez l'opération et téléchargez le PDF rechiffré avec son nouveau mot de passe.",
      ],
    },
    capabilities: [
      "Rotation du mot de passe d'un PDF déjà chiffré, en une seule étape",
      "Définition d'un mot de passe sur un PDF qui n'en avait pas",
      "Mots de passe utilisateur (ouverture) et propriétaire (permissions) distincts",
      "Ré-chiffrement AES-256 ou AES-128 par le moteur PDF maison",
      "Permissions d'origine conservées lors du changement, jamais élargies en silence",
      "Mot de passe traité en mémoire le temps de la requête, jamais stocké ni journalisé",
    ],
    faq: [
      {
        question: "Quelle différence avec l'outil de déverrouillage ?",
        answer:
          "Le déverrouillage retire complètement la protection et produit un PDF en clair. Ici, vous remplacez le mot de passe par un autre : le document reste chiffré, mais avec une nouvelle clé que vous seul connaissez.",
      },
      {
        question: "Dois-je connaître le mot de passe actuel ?",
        answer:
          "Oui, si le PDF est déjà protégé : c'est lui qui autorise le changement, GigaPDF ne contourne aucune protection. En revanche, un PDF sans mot de passe peut en recevoir un sans rien fournir d'autre que le fichier.",
      },
      {
        question: "Puis-je définir un mot de passe propriétaire seul ?",
        answer:
          "Oui. Le mot de passe propriétaire contrôle les permissions (impression, copie, modification) sans forcément exiger de mot de passe à l'ouverture. Vous pouvez renseigner l'un, l'autre, ou les deux.",
      },
      {
        question: "Mes permissions sont-elles conservées ?",
        answer:
          "Quand vous changez le mot de passe d'un fichier déjà protégé, GigaPDF réutilise les permissions existantes du document au lieu de tout réautoriser. Le niveau d'accès reste celui que vous aviez fixé.",
      },
      {
        question: "Le mot de passe est-il transmis quelque part ?",
        answer:
          "Non. Il sert uniquement à ouvrir et rechiffrer le fichier pendant la requête, puis il disparaît. Rien n'est conservé côté serveur, et GigaPDF est open source et auto-hébergeable pour un contrôle total.",
      },
    ],
    useCases: [
      "Faire tourner régulièrement le mot de passe d'un document sensible partagé",
      "Révoquer l'accès d'un tiers en remplaçant le mot de passe qu'il connaissait",
      "Protéger un PDF reçu en clair avant de le diffuser",
    ],
    relatedTools: ["proteger-pdf", "deverrouiller-pdf", "signer-pdf"],
    relatedSolutions: ["avocats", "experts-comptables"],
    icon: "key-round",
    appHref: "/change-password",
  },
  {
    slug: "aplatir-pdf",
    name: "Aplatir un PDF",
    category: "edit",
    metaTitle: "Aplatir un PDF : figer formulaires et annotations | GigaPDF",
    metaDescription:
      "Aplatissez les champs de formulaire et les annotations d'un PDF en contenu statique : le rendu reste identique, mais le document devient non modifiable.",
    h1: "Aplatir un PDF : figer formulaires et annotations en contenu statique",
    intro: [
      "Un formulaire rempli que le destinataire pourrait encore vider d'un clic, des commentaires de relecture qui s'affichent dans certains lecteurs mais pas dans d'autres, un tampon que l'on peut déplacer : tant qu'un PDF contient des éléments interactifs, son apparence n'est pas vraiment figée. L'aplatissement règle ce problème en fusionnant ces éléments dans le contenu de la page.",
      "GigaPDF transforme les champs de formulaire et les annotations en contenu statique : ce qui est affiché à l'écran reste exactement identique, mais devient une partie intégrante de la page, impossible à modifier ou à supprimer après coup. Les valeurs saisies, les cases cochées, les surlignages et les tampons sont gravés dans le document une fois pour toutes.",
      "Vous choisissez ce qui est aplati : seulement les formulaires, seulement les annotations, ou les deux à la fois. L'opération est entièrement réalisée par le moteur PDF maison, sans dépendance tierce, et produit un fichier prêt pour l'impression, l'archivage ou la diffusion — là où la stabilité du rendu compte plus que la modifiabilité.",
    ],
    howTo: {
      title: "Comment aplatir un PDF",
      steps: [
        "Importez le PDF contenant des formulaires ou des annotations à figer.",
        "Choisissez la cible : les formulaires, les annotations, ou l'ensemble.",
        "Lancez l'aplatissement : les éléments interactifs deviennent du contenu statique.",
        "Vérifiez que le rendu reste identique à l'original.",
        "Téléchargez le PDF aplati, prêt à être imprimé, archivé ou diffusé.",
      ],
    },
    capabilities: [
      "Aplatissement des champs de formulaire : les valeurs saisies sont figées dans la page",
      "Aplatissement des annotations : commentaires, surlignages et tampons gravés dans le contenu",
      "Choix de la cible : formulaires, annotations, ou les deux",
      "Rendu visuel strictement préservé, mais document rendu non interactif",
      "Document finalisé pour l'impression, l'archivage et la diffusion",
      "Traitement par le moteur PDF maison, sans dépendance tierce",
    ],
    faq: [
      {
        question: "Que deviennent les champs de formulaire après aplatissement ?",
        answer:
          "Leurs valeurs sont conservées telles qu'affichées, mais le champ disparaît en tant qu'élément interactif : on ne peut plus le vider ni le remodifier. Le formulaire rempli devient du texte intégré à la page.",
      },
      {
        question: "L'apparence du document change-t-elle ?",
        answer:
          "Non. L'aplatissement préserve le rendu au pixel près : la seule différence est que les éléments concernés ne sont plus modifiables. C'est précisément le but, figer ce qui est affiché.",
      },
      {
        question: "Puis-je aplatir uniquement les annotations ?",
        answer:
          "Oui. L'outil propose trois cibles : les formulaires seuls, les annotations seules, ou les deux. Vous gardez les champs interactifs si vous n'aplatissez que les annotations, et inversement.",
      },
      {
        question: "Pourquoi aplatir un PDF avant de l'envoyer ?",
        answer:
          "Pour garantir que le destinataire voit exactement ce que vous avez validé, sans pouvoir altérer un formulaire ni faire disparaître une annotation. C'est aussi utile avant impression, car certains éléments interactifs s'impriment mal selon le lecteur.",
      },
      {
        question: "L'aplatissement supprime-t-il du contenu ?",
        answer:
          "Non, il fige le contenu existant au lieu de l'effacer. Les valeurs et marques visibles restent présentes ; elles cessent simplement d'être des objets modifiables. Pour retirer réellement du contenu, utilisez plutôt l'édition.",
      },
    ],
    useCases: [
      "Verrouiller un formulaire rempli avant de le renvoyer signé",
      "Figer les annotations de relecture avant l'archivage d'un dossier",
      "Préparer un document stable pour l'impression ou la diffusion publique",
    ],
    relatedTools: ["formulaires-pdf", "annoter-pdf", "proteger-pdf"],
    relatedSolutions: ["experts-comptables", "ressources-humaines"],
    icon: "layers",
    appHref: "/flatten",
  },
];

/** Index par slug pour les pages dynamiques. */
const TOOLS_BY_SLUG = new Map(TOOLS.map((tool) => [tool.slug, tool]));

export function getToolBySlug(slug: string): ToolData | undefined {
  return TOOLS_BY_SLUG.get(slug);
}

export function getAllToolSlugs(): string[] {
  return TOOLS.map((tool) => tool.slug);
}
