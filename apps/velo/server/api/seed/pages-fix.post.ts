/**
 * Fix Vélo Solidaire pages with proper TipTap JSON content.
 * Converts the rich markdown from seed source files into TipTap editor format.
 *
 * POST /api/seed/pages-fix
 */
import { eq } from 'drizzle-orm'
import { organization } from '~~/server/db/schema'
import { pagesPages } from '@fyit/crouton-pages/collections/pages/server/database/schema'

// ---------------------------------------------------------------------------
// TipTap JSON builders
// ---------------------------------------------------------------------------

interface TipTapNode {
  type: string
  attrs?: Record<string, any>
  content?: TipTapNode[]
  marks?: Array<{ type: string; attrs?: Record<string, any> }>
  text?: string
}

function doc(...content: TipTapNode[]): string {
  return JSON.stringify({ type: 'doc', content })
}

function heading(level: number, ...content: TipTapNode[]): TipTapNode {
  return { type: 'heading', attrs: { level }, content }
}

function paragraph(...content: TipTapNode[]): TipTapNode {
  if (content.length === 0) return { type: 'paragraph' }
  return { type: 'paragraph', content }
}

function text(str: string, marks?: TipTapNode['marks']): TipTapNode {
  const node: TipTapNode = { type: 'text', text: str }
  if (marks && marks.length > 0) node.marks = marks
  return node
}

function bold(str: string): TipTapNode {
  return text(str, [{ type: 'bold' }])
}

function italic(str: string): TipTapNode {
  return text(str, [{ type: 'italic' }])
}

function boldItalic(str: string): TipTapNode {
  return text(str, [{ type: 'bold' }, { type: 'italic' }])
}

function link(label: string, href: string, extraMarks: Array<{ type: string }> = []): TipTapNode {
  return text(label, [
    ...extraMarks,
    { type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null } }
  ])
}

function image(src: string): TipTapNode {
  return { type: 'image', attrs: { src } }
}

function bulletList(...items: TipTapNode[][]): TipTapNode {
  return {
    type: 'bulletList',
    content: items.map(itemContent => ({
      type: 'listItem',
      content: [paragraph(...itemContent)]
    }))
  }
}

function hardBreak(): TipTapNode {
  return { type: 'hardBreak' }
}

// ---------------------------------------------------------------------------
// Page content builders - one per page, hand-crafted for quality
// ---------------------------------------------------------------------------

function buildHomepageFR(): string {
  return doc(
    heading(3, text('Bienvenue sur le site de Vélo Solidaire !')),
    paragraph(
      text('Découvrez ici comment nous pouvons vous aider, vous et votre association, à mettre votre public en selle, à disposer de vélos pour organiser des activités avec votre public ou simplement pour vous accompagner dans la mise en place de votre projet vélo.')
    ),
    paragraph(
      bold('Vélo Solidaire s\'adresse uniquement aux associations bruxelloises.')
    )
  )
}

function buildHomepageNL(): string {
  return doc(
    heading(3, text('Welkom op de website van Solidaire Velo !')),
    paragraph(
      text('Ontdek hier hoe we jou en je vereniging kunnen helpen om je groep te leren fietsen, om fietsen te bekomen of bij het vormgeven van jullie eigen fietsproject.')
    ),
    paragraph(
      bold('Solidaire Velo richt zich uitsluitend op Brusselse verenigingen.')
    )
  )
}

function buildHomepageEN(): string {
  return doc(
    heading(3, text('Welcome to Vélo Solidaire!')),
    paragraph(
      text('Discover how we can help you and your association get your audience cycling, provide bikes for group activities, or support you in setting up your bike project.')
    ),
    paragraph(
      bold('Vélo Solidaire is exclusively for Brussels-based associations.')
    )
  )
}

function buildAProposFR(): string {
  return doc(
    heading(1, bold('A propos de Vélo Solidaire...')),
    paragraph(
      bold('Vélo Solidaire a démarré fin 2020 avec l\'objectif de faciliter l\'accès à la pratique du vélo à Bruxelles. Pour ce faire, le projet s\'adresse aux associations bruxelloises dont le public est éloigné de la pratique du vélo pour des raisons culturelles, sociales, économiques ou de genre.')
    ),
    paragraph(
      text('Ainsi, Vélo Solidaire offre '),
      boldItalic('des parcours pour le public de votre association'),
      text(' comprenant de la mise en selle, des cours de vélo dans la circulation, la mise à disposition d\'un vélo reconditionné pendant un an (avec la possibilité de le racheter à la fin) ainsi qu\'une introduction à l\'entretien et à la mécanique du vélo.')
    ),
    paragraph(
      text('Par ailleurs, Vélo Solidaire propose des formations '),
      boldItalic('pour le personnel des associations'),
      text(' afin de les rendre les plus autonomes possible dans la mise en place de leur projet vélo : mise en selle, encadrement d\'un groupe dans la circulation, mécanique de base, organiser une sortie, tracer un itinéraire...')
    ),
    heading(3, bold('Vélo Solidaire en quelques chiffres')),
    paragraph(
      text('Depuis le début du projet, ce sont plus de 1400 personnes qui ont appris à rouler à vélo, ont reçu un vélo reconditionné et ont appris à l\'entretenir correctement. En moyenne, 3/4 des personnes qui ont reçu un vélo souhaitent le racheter après l\'avoir utilisé pendant un an. Les autres nous rendent le vélo pour qu\'il puisse être remis à un·e autre participant·e. Heureusement, très peu de vélos ont été déclarés volés (2%).')
    ),
    heading(3, bold('Rapport d\'activité')),
    paragraph(
      link('Rapport d\'activité Vélo Solidaire 2023', '/img/rapport-d-activité-vélo-solidaire-2023.pdf')
    ),
    heading(3, bold('Étude d\'impact')),
    paragraph(
      text('En octobre 2022, Vélo Solidaire a fait faire une évaluation de l\'impact social du projet par le SAW-B.')
    ),
    paragraph(
      link('Étude d\'impact', '/img/vélo_solidaire_étude_web_8_12_compressed-1-.pdf')
    ),
    heading(3, bold('Partenariat')),
    paragraph(
      text('Vélo Solidaire est le fruit d\'un partenariat entre les Ateliers de la rue Voot, CyCLO et Pro Velo. Il est financé par Bruxelles Mobilité.')
    )
  )
}

function buildAProposNL(): string {
  return doc(
    heading(1, text('Over Solidaire Velo')),
    paragraph(
      bold('Solidaire Velo werd eind 2020 opgericht om de toegang tot de fiets in Brussel te vergemakkelijken. Het project richt zich tot Brusselse verenigingen waarvan de gebruikers of leden geen of moeilijk toegang hebben tot de fiets omwille van culturele, sociale, economische of gendergerelateerde redenen.')
    ),
    paragraph(
      text('Solidaire Velo biedt opleidingen aan om de '),
      boldItalic('deelnemers van de vereniging'),
      text(' te leren fietsen (tout-court en/of in het verkeer) en om hun fiets te leren onderhouden. Het project stelt ook opgeknapte fietsen ter beschikking die de deelnemers een jaar lang kunnen gebruiken en na afloop kunnen kopen.')
    ),
    paragraph(
      text('Daarnaast biedt Solidaire Velo ook opleidingen aan voor de '),
      boldItalic('medewerkers van de vereniging'),
      text(' zodat zij zelf hun eigen fietsproject kunnen vormgeven: het leren fietsen, het begeleiden van een groep in het verkeer, basismechanica, het organiseren van een fietsuitstap, het uitstippelen van een route etc.')
    ),
    heading(3, bold('Solidaire Velo in cijfers')),
    paragraph(
      text('Sinds het begin van het project hebben meer dan 1.400 mensen leren fietsen, een opgeknapte fiets gekregen en geleerd hoe ze die goed kunnen onderhouden. Ongeveer 75% van de mensen die een fiets hebben gekregen en hem een jaar hebben gebruikt, gaat nadien over tot een aankoop. De anderen leveren de fiets in, zodat hij kan dienen voor een andere deelnemer. Er worden gelukkig maar heel weinig fietsen als gestolen opgegeven (2%).')
    ),
    heading(3, bold('Activiteitenverslag')),
    paragraph(
      link('Activiteitenverslag Solidaire Velo 2023', '/img/rapport-d-activité-vélo-solidaire-2023.pdf')
    ),
    heading(3, bold('Impactstudie')),
    paragraph(
      text('In oktober 2022 gaf Solidaire Velo de opdracht aan SAW-B om de sociale impact van het project te beoordelen.')
    ),
    paragraph(
      link('Impactstudie', '/img/vélo_solidaire_étude_web_8_12_compressed-1-.pdf')
    ),
    heading(3, bold('Partnerschap')),
    paragraph(
      text('Solidaire Velo is het resultaat van een samenwerking tussen Les Ateliers de la rue Voot, CyCLO en Pro Velo. Het wordt gefinancierd door Brussel Mobiliteit.')
    )
  )
}

function buildAProposEN(): string {
  return doc(
    heading(1, text('About Vélo Solidaire')),
    paragraph(
      bold('Vélo Solidaire started at the end of 2020 with the goal of making cycling more accessible in Brussels. The project targets Brussels-based associations whose audiences are far from cycling for cultural, social, economic, or gender-related reasons.')
    ),
    paragraph(
      text('Vélo Solidaire offers '),
      boldItalic('courses for your association\'s audience'),
      text(' including learning to ride, cycling in traffic, provision of a refurbished bike for one year (with the option to purchase it afterwards), and an introduction to bike maintenance and basic mechanics.')
    ),
    paragraph(
      text('Additionally, Vélo Solidaire offers training '),
      boldItalic('for association staff'),
      text(' to help them become as autonomous as possible in setting up their bike project: learning to ride, supervising a group in traffic, basic mechanics, organizing outings, planning routes...')
    ),
    heading(3, bold('Vélo Solidaire in numbers')),
    paragraph(
      text('Since the beginning of the project, more than 1,400 people have learned to ride a bike, received a refurbished bike, and learned to maintain it properly. On average, 3/4 of people who received a bike wish to purchase it after using it for a year. The others return the bike so it can be given to another participant. Fortunately, very few bikes have been reported stolen (2%).')
    ),
    heading(3, bold('Activity Report')),
    paragraph(
      link('Vélo Solidaire Activity Report 2023', '/img/rapport-d-activité-vélo-solidaire-2023.pdf')
    ),
    heading(3, bold('Impact Study')),
    paragraph(
      text('In October 2022, Vélo Solidaire commissioned SAW-B to evaluate the social impact of the project.')
    ),
    paragraph(
      link('Impact Study', '/img/vélo_solidaire_étude_web_8_12_compressed-1-.pdf')
    ),
    heading(3, bold('Partnership')),
    paragraph(
      text('Vélo Solidaire is the result of a partnership between Les Ateliers de la rue Voot, CyCLO and Pro Velo. It is funded by Brussels Mobility.')
    )
  )
}

function buildParcoursFR(): string {
  return doc(
    heading(1, text('Deux types de parcours')),
    paragraph(
      text('En fonction des besoins de votre public, deux types d\'accompagnement vous sont proposés. Si vous souhaitez faire une demande de participation au projet, merci de choisir le parcours qui vous intéresse et de remplir le formulaire correspondant.')
    ),
    heading(3, italic('Parcours d\'apprentissage')),
    paragraph(
      text('Ce parcours s\'adresse à un public qui n\'a jamais appris à pédaler.')
    ),
    paragraph(bold('Objectifs :')),
    bulletList(
      [text('Apprendre à pédaler')],
      [text('Apprendre à rouler dans le trafic')],
      [text('S\'approprier le vélo')]
    ),
    paragraph(bold('Étapes du parcours :')),
    bulletList(
      [text('6 séances de formation pour apprendre à pédaler')],
      [text('6 séances de formation pour apprendre à rouler dans le trafic')],
      [text('La mise à disposition d\'un vélo reconditionné gratuite pendant 1 an à chaque participant·e')],
      [text('1 séance de formation à l\'entretien du vélo et à la mécanique de base')]
    ),
    paragraph(
      bold('Tarif : '),
      text('800€ pour tout le groupe (entre 5 et 12 personnes maximum)'),
      hardBreak(),
      text('Si le coût de votre participation devait représenter un frein, n\'hésitez pas à nous contacter, nous chercherons une solution ensemble.')
    ),
    heading(3, italic('Parcours d\'autonomie')),
    paragraph(
      text('Ce parcours s\'adresse à un public qui sait déjà rouler, mais qui se trouve en grande précarité de mobilité et qui a surtout besoin d\'avoir un vélo à disposition.')
    ),
    paragraph(bold('Objectif : '), text('S\'approprier le vélo')),
    paragraph(bold('Étapes du parcours :')),
    bulletList(
      [text('La mise à disposition d\'un vélo reconditionné gratuite pendant 1 an à chaque participant·e')],
      [text('2 séances de formation sur mesure en fonction des besoins')],
      [text('1 séance de formation à l\'entretien du vélo et à la mécanique de base')]
    ),
    paragraph(
      bold('Tarif : '),
      text('100€ pour tout le groupe (entre 5 et 12 personnes maximum)')
    )
  )
}

function buildParcoursNL(): string {
  return doc(
    heading(1, text('Twee types trajecten')),
    paragraph(
      text('Afhankelijk van de behoeften van uw publiek, worden u twee soorten ondersteuning aangeboden. Als u zich wilt aanmelden voor deelname aan het project, kies dan het traject die u interesseert en vul het bijbehorende formulier in.')
    ),
    heading(3, italic('Leertraject')),
    paragraph(
      text('Dit traject is bedoeld voor mensen die nog nooit hebben leren trappen.')
    ),
    paragraph(bold('Doelstellingen:')),
    bulletList(
      [text('Leren fietsen')],
      [text('Leren fietsen in het verkeer')],
      [text('Aan de fiets wennen')]
    ),
    paragraph(bold('Etappes van het traject:')),
    bulletList(
      [text('6 sessies om te leren fietsen')],
      [text('6 sessies om veilig in het verkeer te leren fietsen')],
      [text('De overhandiging van een fiets aan elke deelnemer + opleiding fietsen in het verkeer')],
      [text('1 les in fietsonderhoud + basismechanica')]
    ),
    paragraph(
      bold('Prijs: '),
      text('€800 voor de hele groep (tussen 5 en maximaal 12 personen)')
    ),
    heading(3, italic('Traject naar zelfstandigheid')),
    paragraph(
      text('Dit traject is bedoeld voor mensen die al kunnen fietsen, maar die zich in een precaire mobiliteitssituatie bevinden en vooral een fiets nodig hebben.')
    ),
    paragraph(bold('Doelstelling: '), text('Wennen aan de fiets')),
    paragraph(bold('Etappes van het traject:')),
    bulletList(
      [text('De overhandiging van een fiets aan elke deelnemer + opleiding fietsen in het verkeer')],
      [text('2 sessies op maat op basis van behoeften')],
      [text('1 opleiding fietsonderhoud + basismechanica')]
    ),
    paragraph(
      bold('Prijs: '),
      text('€100 voor de hele groep (tussen 5 en maximaal 12 personen)')
    )
  )
}

function buildParcoursEN(): string {
  return doc(
    heading(1, text('Two types of courses')),
    paragraph(
      text('Depending on the needs of your audience, two types of support are offered. If you wish to apply for the project, please choose the course that interests you and fill in the corresponding form.')
    ),
    heading(3, italic('Learning course')),
    paragraph(
      text('This course is aimed at people who have never learned to ride a bike.')
    ),
    paragraph(bold('Objectives:')),
    bulletList(
      [text('Learn to pedal')],
      [text('Learn to ride in traffic')],
      [text('Get comfortable with the bike')]
    ),
    paragraph(bold('Course stages:')),
    bulletList(
      [text('6 training sessions to learn to pedal')],
      [text('6 training sessions to learn to ride in traffic')],
      [text('Free provision of a refurbished bike for 1 year to each participant')],
      [text('1 bike maintenance and basic mechanics session')]
    ),
    paragraph(
      bold('Price: '),
      text('€800 for the whole group (between 5 and 12 people maximum)')
    ),
    heading(3, italic('Autonomy course')),
    paragraph(
      text('This course is for people who already know how to ride but are in great mobility precarity and mainly need a bike.')
    ),
    paragraph(bold('Objective: '), text('Get comfortable with the bike')),
    paragraph(bold('Course stages:')),
    bulletList(
      [text('Free provision of a refurbished bike for 1 year to each participant')],
      [text('2 tailored training sessions based on needs')],
      [text('1 bike maintenance and basic mechanics session')]
    ),
    paragraph(
      bold('Price: '),
      text('€100 for the whole group (between 5 and 12 people maximum)')
    )
  )
}

function buildServicesFR(): string {
  return doc(
    heading(1, text('Services à la carte')),
    paragraph(
      text('Vous ne vous retrouvez pas dans les parcours proposés ? Ou bien vous souhaitez aller plus loin ? Composez vous-même votre parcours et servez-vous dans notre boîte à outils.')
    ),
    heading(3, text('Avoir accès à des vélos')),
    bulletList(
      [link('Réservez une de nos flottes Vélo Solidaire', '/bookings'), text(' pour organiser des activités avec votre public.')],
      [boldItalic('Installez une flotte'), text(' de vélos au sein de votre association. Vélo Solidaire peut vous fournir des vélos reconditionnés et vous aider à mettre en place un système de gestion.')]
    ),
    heading(3, text('Réparer des vélos')),
    bulletList(
      [text('Organisez '), boldItalic('un atelier mobile'), text(' de réparation de vélos au sein de votre association.')],
      [text('Vos participants aimeraient connaître un lieu où ils peuvent réparer leur vélo eux-mêmes ? Organisez une '), boldItalic('découverte de l\'atelier participatif'), text(' des Ateliers de la rue Voot.')]
    ),
    heading(3, text('Apprendre à un groupe à pédaler')),
    paragraph(
      text('Formation pour apprendre à mettre un groupe en selle en toute sécurité.')
    ),
    paragraph(
      bold('Dates et inscriptions : '),
      link('ici', 'https://www.billetweb.fr/formation-mise-en-selle')
    ),
    heading(3, text('Encadrer un groupe dans la circulation')),
    bulletList(
      [boldItalic('Encadrer un groupe de cyclistes dans la circulation'), text(' : une formation pour apprendre à encadrer un groupe dans le trafic.')],
      [text('Nous pouvons '), boldItalic('vous soutenir dans l\'encadrement du groupe'), text(' lors de vos premières sorties.')],
      [boldItalic('Le choix de l\'itinéraire'), text(' : nous pouvons vous aider à trouver les meilleurs itinéraires cyclables.')]
    ),
    heading(3, text('Proposer des sorties à ses participant·e·s')),
    bulletList(
      [boldItalic('Bike Experience'), text(' : un programme de balades à vélo à Bruxelles. '), link('bikeexperience.brussels', 'https://bikeexperience.brussels/')],
      [text('Des '), boldItalic('balades guidées'), text(' adaptées à votre public.')]
    ),
    heading(3, text('Trouver du parking pour les Vélos Solidaires')),
    bulletList(
      [text('Si vous manquez de lieu sécurisé pour garer les vélos, nous pouvons vous aider à trouver une solution de parking.')]
    )
  )
}

function buildServicesNL(): string {
  return doc(
    heading(1, text('Diensten à la carte')),
    paragraph(
      text('Vind je niet wat je zoekt? Of wil je nog een stapje verder gaan? Stel zelf je parcours samen en neem een kijkje tussen het volledige activiteitenaanbod.')
    ),
    heading(3, text('Op zoek naar fietsen')),
    bulletList(
      [link('Reserveer een van onze Solidaire Velo-fietsvloten', '/bookings'), text(' om activiteiten met je publiek te organiseren.')],
      [boldItalic('Herberg zelf een fietsvloot'), text(' binnen je vereniging. Solidaire Velo kan je opgeknapte fietsen leveren en helpen bij het opzetten van een beheersysteem.')]
    ),
    heading(3, text('Fietsen herstellen')),
    bulletList(
      [text('Organiseer '), boldItalic('een mobiel fietsatelier'), text(' binnen je vereniging.')],
      [text('Je deelnemers willen leren waar ze hun fiets zelf kunnen herstellen? Organiseer een bezoek aan '), boldItalic('een participatief fietsatelier'), text(' van de Ateliers de la rue Voot.')]
    ),
    heading(3, text('Een groep leren fietsen')),
    paragraph(
      text('Opleiding om een groep veilig te leren fietsen.')
    ),
    paragraph(
      bold('Data en inschrijving: '),
      link('hier', 'https://www.billetweb.fr/formation-mise-en-selle')
    ),
    heading(3, text('Een groep begeleiden in het verkeer')),
    bulletList(
      [boldItalic('Een groep fietsers begeleiden in het verkeer'), text(': een opleiding om een groep in het verkeer te begeleiden.')],
      [text('We kunnen '), boldItalic('ondersteuning bieden om de groep te begeleiden'), text(' tijdens jullie eerste uitstappen.')],
      [boldItalic('De keuze van de route'), text(': we kunnen je helpen de beste fietsroutes te vinden.')]
    ),
    heading(3, text('Fietstochten organiseren')),
    bulletList(
      [boldItalic('Bike Experience'), text(': een programma van fietstochtjes in Brussel. '), link('bikeexperience.brussels', 'https://bikeexperience.brussels/')],
      [text('Aangepaste '), boldItalic('gegidste fietstochten'), text(' voor je publiek.')]
    ),
    heading(3, text('Fietsparking vinden')),
    bulletList(
      [text('Als je geen veilige plek hebt om de fietsen te stallen, kunnen we je helpen een parkeeroplossing te vinden.')]
    )
  )
}

function buildServicesEN(): string {
  return doc(
    heading(1, text('À la carte services')),
    paragraph(
      text('Don\'t find what you\'re looking for in the standard courses? Or want to go further? Build your own programme from our toolbox.')
    ),
    heading(3, text('Access to bikes')),
    bulletList(
      [link('Book one of our Vélo Solidaire fleets', '/bookings'), text(' to organize activities with your audience.')],
      [boldItalic('Host a fleet'), text(' of bikes at your association. Vélo Solidaire can provide refurbished bikes and help set up a management system.')]
    ),
    heading(3, text('Bike repair')),
    bulletList(
      [text('Organize '), boldItalic('a mobile repair workshop'), text(' at your association.')],
      [text('Your participants would like to discover a place where they can repair their bikes themselves? Organize a visit to '), boldItalic('the participatory workshop'), text(' at Les Ateliers de la rue Voot.')]
    ),
    heading(3, text('Teaching a group to ride')),
    paragraph(text('Training to safely teach a group to ride bikes.')),
    paragraph(
      bold('Dates and registration: '),
      link('here', 'https://www.billetweb.fr/formation-mise-en-selle')
    ),
    heading(3, text('Supervising a group in traffic')),
    bulletList(
      [boldItalic('Supervising a group of cyclists in traffic'), text(': training to lead a group in traffic.')],
      [text('We can '), boldItalic('support you in supervising the group'), text(' during your first outings.')],
      [boldItalic('Route planning'), text(': we can help you find the best cycling routes.')]
    ),
    heading(3, text('Organizing outings')),
    bulletList(
      [boldItalic('Bike Experience'), text(': a programme of bike rides in Brussels. '), link('bikeexperience.brussels', 'https://bikeexperience.brussels/')],
      [text('Adapted '), boldItalic('guided rides'), text(' for your audience.')]
    ),
    heading(3, text('Finding bike parking')),
    bulletList(
      [text('If you lack secure storage for the bikes, we can help you find a parking solution.')]
    )
  )
}

function buildBookingsFR(): string {
  return doc(
    heading(1, text('Réserver une flotte de vélos')),
    paragraph(
      text('Les flottes Vélos Solidaire sont accessibles à toute association psycho/socio/culturelle ou de promotion de la santé et de la cohésion sociale active en Région bruxelloise et qui s\'adresse à un public moins favorisé. Les vélos sont disponibles à titre gratuit pour des activités d\'apprentissage du vélo ou pour des sorties à vélo en groupe.')
    ),
    paragraph(
      text('Les flottes Vélo Solidaire sont reprises ci-dessous avec une description des vélos et du matériel disponible ainsi que les horaires d\'ouverture.')
    ),
    paragraph(
      bold('Veuillez lire la charte d\'utilisation avant de choisir la flotte et la date qui vous convient.')
    ),
    heading(3, text('Charte d\'utilisation')),
    bulletList(
      [text('Respectez les horaires d\'ouverture et de fermeture.')],
      [text('Ne réservez pas trop longtemps à l\'avance afin de laisser la possibilité à d\'autres associations.')],
      [text('Annulez à temps si vous ne pouvez pas venir.')],
      [text('Vérifiez les pneus, les selles et les freins avant chaque sortie.')],
      [text('Rendez les vélos dans le même état que vous les avez trouvés.')],
      [text('Organisez les vélos par taille.')],
      [text('Signalez tout problème mécanique.')],
      [text('Gardez les locaux propres.')],
      [text('L\'assurance est obligatoire pour les participant·e·s.')],
      [text('En cas de vol ou de perte : 250€ + 15€ pour le cadenas.')]
    ),
    paragraph(
      italic('En parler autour de vous pour en faire profiter un maximum de personnes !')
    )
  )
}

function buildBookingsNL(): string {
  return doc(
    heading(1, text('Een fietsvloot reserveren')),
    paragraph(
      text('De fietsvloot van Solidaire Velo staat ter beschikking van elke (socio-)culturele vereniging die zich inzet voor de gezondheid en de sociale cohesie van een kansarm publiek en actief is in het Brussels Gewest. De fietsen zijn gratis beschikbaar om te leren fietsen of voor een fietstocht in groep.')
    ),
    paragraph(
      text('Hieronder vindt u de vloten van Solidaire Velo met een beschrijving van de fietsen en het beschikbare materiaal.')
    ),
    paragraph(
      bold('Lees de gebruikersovereenkomst alvorens je een vloot en datum kiest.')
    ),
    heading(3, text('Gebruikersovereenkomst')),
    bulletList(
      [text('Respecteer de openings- en sluitingstijden.')],
      [text('Reserveer niet te lang op voorhand, zodat andere verenigingen ook de kans krijgen.')],
      [text('Annuleer op tijd als je niet kunt komen.')],
      [text('Controleer banden, zadels en remmen voor elke rit.')],
      [text('Breng de fietsen terug in dezelfde staat als je ze hebt aangetroffen.')],
      [text('Sorteer de fietsen op grootte.')],
      [text('Meld elk mechanisch probleem.')],
      [text('Houd de ruimte schoon.')],
      [text('Een verzekering is verplicht voor de deelnemers.')],
      [text('Bij diefstal of verlies: €250 + €15 voor het slot.')]
    ),
    paragraph(
      italic('Spread the word, om zo veel mogelijk mensen van deze dienst te laten genieten!')
    )
  )
}

function buildBookingsEN(): string {
  return doc(
    heading(1, text('Book a bike fleet')),
    paragraph(
      text('The Vélo Solidaire fleets are available to any psycho/socio/cultural association or health and social cohesion promotion organization active in the Brussels Region that serves a disadvantaged audience. The bikes are available free of charge for cycling learning activities or group bike outings.')
    ),
    paragraph(
      text('The Vélo Solidaire fleets are listed below with a description of the bikes and available equipment as well as opening hours.')
    ),
    paragraph(
      bold('Please read the usage charter before choosing the fleet and date that suits you.')
    ),
    heading(3, text('Usage charter')),
    bulletList(
      [text('Respect the opening and closing times.')],
      [text('Don\'t book too far in advance to leave room for other associations.')],
      [text('Cancel in time if you can\'t make it.')],
      [text('Check tires, seats and brakes before each outing.')],
      [text('Return the bikes in the same condition you found them.')],
      [text('Organize bikes by size.')],
      [text('Report any mechanical issues.')],
      [text('Keep the premises clean.')],
      [text('Insurance is mandatory for participants.')],
      [text('In case of theft or loss: €250 + €15 for the lock.')]
    ),
    paragraph(
      italic('Spread the word to let as many people as possible benefit!')
    )
  )
}

function buildContactFR(): string {
  return doc(
    heading(1, text('Nous contacter')),
    paragraph(
      text('Intéressé·e·s par un de nos parcours ? Après avoir rempli le '),
      bold('formulaire de demande de participation'),
      text(' correspondant au parcours souhaité, nous prendrons contact avec vous pour évaluer ensemble la faisabilité de votre projet.')
    ),
    paragraph(
      bold('Formulaire de demande de participation pour le parcours d\'apprentissage : '),
      link('ici', 'https://docs.google.com/forms/d/e/1FAIpQLSfUZG9idqEHy4TLxdLb6C-Hb9IJngMaG9PR7wDTUd3BPD9WqA/viewform')
    ),
    paragraph(
      bold('Formulaire de demande de participation pour le parcours d\'autonomie : '),
      link('ici', 'https://docs.google.com/forms/d/e/1FAIpQLSfDXdj8sUn8bQgjkmfj-jGmC2k74P9LHzPGz2UhqqQ5sDeXiA/viewform')
    ),
    heading(3, text('Des questions ?')),
    bulletList(
      [text('Concernant les formations vélo : Noémie Dembour — '), link('n.dembour@provelo.org', 'mailto:n.dembour@provelo.org')],
      [text('Concernant l\'obtention d\'un vélo reconditionné : Cécile Van Overstraeten — '), link('cecile@cyclo.org', 'mailto:cecile@cyclo.org')],
      [text('Concernant la mécanique : l\'équipe des Ateliers de la rue Voot — '), link('velosolidaire@voot.be', 'mailto:velosolidaire@voot.be')]
    )
  )
}

function buildContactNL(): string {
  return doc(
    heading(1, text('Contact')),
    paragraph(
      text('Interesse in één van onze trajecten? Na het invullen van het '),
      bold('deelnameaanvraagformulier'),
      text(', nemen we contact met je op en beoordelen we samen de haalbaarheid van je fietsproject.')
    ),
    paragraph(
      bold('Aanvraagformulier deelname voor het leertraject: '),
      link('hier', 'https://docs.google.com/forms/d/e/1FAIpQLSdjs11lZgiI2kXcJsNo-jnkaf69M23ukL3z0D4Wn3lakGhEaA/viewform')
    ),
    paragraph(
      bold('Aanvraagformulier deelname voor het traject naar zelfstandigheid: '),
      link('hier', 'https://docs.google.com/forms/d/e/1FAIpQLSdrn0IXxMrafrRrKzJ8utwI6cMOI-TYf1OS7nWarHRDrTchow/viewform')
    ),
    heading(3, text('Vragen?')),
    bulletList(
      [text('Voor fietsopleidingen: Noémie Dembour — '), link('n.dembour@provelo.org', 'mailto:n.dembour@provelo.org')],
      [text('Voor het bekomen van een tweedehandsfiets: Cécile Van Overstraeten — '), link('cecile@cyclo.org', 'mailto:cecile@cyclo.org')],
      [text('Voor vragen m.b.t. fietsmechaniek: het team van Ateliers de la rue Voot — '), link('velosolidaire@voot.be', 'mailto:velosolidaire@voot.be')]
    )
  )
}

function buildContactEN(): string {
  return doc(
    heading(1, text('Contact us')),
    paragraph(
      text('Interested in one of our courses? After filling in the '),
      bold('participation request form'),
      text(' for the course of your choice, we will contact you to evaluate the feasibility of your project together.')
    ),
    paragraph(
      bold('Participation request form for the learning course: '),
      link('here', 'https://docs.google.com/forms/d/e/1FAIpQLSfUZG9idqEHy4TLxdLb6C-Hb9IJngMaG9PR7wDTUd3BPD9WqA/viewform')
    ),
    paragraph(
      bold('Participation request form for the autonomy course: '),
      link('here', 'https://docs.google.com/forms/d/e/1FAIpQLSfDXdj8sUn8bQgjkmfj-jGmC2k74P9LHzPGz2UhqqQ5sDeXiA/viewform')
    ),
    heading(3, text('Questions?')),
    bulletList(
      [text('About cycling training: Noémie Dembour — '), link('n.dembour@provelo.org', 'mailto:n.dembour@provelo.org')],
      [text('About getting a refurbished bike: Cécile Van Overstraeten — '), link('cecile@cyclo.org', 'mailto:cecile@cyclo.org')],
      [text('About mechanics: the team at Ateliers de la rue Voot — '), link('velosolidaire@voot.be', 'mailto:velosolidaire@voot.be')]
    )
  )
}

function buildRegisterFR(): string {
  return doc(
    heading(1, text('Inscription')),
    paragraph(
      text('Remplissez le questionnaire suivant, nous traitons votre demande dès que possible.')
    ),
    paragraph(
      text('Pour vous inscrire au projet Vélo Solidaire, veuillez remplir le formulaire ci-dessous. Nous reviendrons vers vous rapidement.')
    )
  )
}

function buildRegisterNL(): string {
  return doc(
    heading(1, text('Inschrijving')),
    paragraph(
      text('Vul het volgende formulier in, we behandelen uw aanvraag zo snel mogelijk.')
    ),
    paragraph(
      text('Om je in te schrijven voor het project Solidaire Velo, vul het onderstaande formulier in. We nemen snel contact met je op.')
    )
  )
}

function buildRegisterEN(): string {
  return doc(
    heading(1, text('Registration')),
    paragraph(
      text('Fill in the following questionnaire, we will process your request as soon as possible.')
    ),
    paragraph(
      text('To register for the Vélo Solidaire project, please fill in the form below. We will get back to you shortly.')
    )
  )
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default defineEventHandler(async () => {
  if (!import.meta.dev) {
    throw createError({ status: 403, statusText: 'Dev only' })
  }

  const db = useDB()
  const log: string[] = []

  // Find org
  const orgs = await (db as any).select().from(organization).where(eq(organization.slug as any, 'velo-solidaire')).limit(1)
  if (orgs.length === 0) {
    throw createError({ status: 404, statusText: 'Organization velo-solidaire not found' })
  }
  const orgId = orgs[0].id

  // Get all pages
  const pages = await (db as any).select().from(pagesPages).where(eq(pagesPages.teamId as any, orgId))

  const pageUpdates: Record<string, { fr: string; nl: string; en: string; title_fr: string; title_nl: string; title_en: string }> = {
    'homepage': {
      fr: buildHomepageFR(), nl: buildHomepageNL(), en: buildHomepageEN(),
      title_fr: 'Accueil', title_nl: 'Home', title_en: 'Home'
    },
    'a-propos': {
      fr: buildAProposFR(), nl: buildAProposNL(), en: buildAProposEN(),
      title_fr: 'À propos', title_nl: 'Over', title_en: 'About'
    },
    'nos-parcours-et-services': {
      fr: buildParcoursFR(), nl: buildParcoursNL(), en: buildParcoursEN(),
      title_fr: 'Nos parcours', title_nl: 'Onze trajecten', title_en: 'Our courses'
    },
    'nos-services-a-la-carte': {
      fr: buildServicesFR(), nl: buildServicesNL(), en: buildServicesEN(),
      title_fr: 'Services à la carte', title_nl: 'Diensten à la carte', title_en: 'À la carte services'
    },
    'bookings': {
      fr: buildBookingsFR(), nl: buildBookingsNL(), en: buildBookingsEN(),
      title_fr: 'Réservations', title_nl: 'Reserveringen', title_en: 'Bookings'
    },
    'contact': {
      fr: buildContactFR(), nl: buildContactNL(), en: buildContactEN(),
      title_fr: 'Contact', title_nl: 'Contact', title_en: 'Contact'
    },
    'register': {
      fr: buildRegisterFR(), nl: buildRegisterNL(), en: buildRegisterEN(),
      title_fr: 'Inscription', title_nl: 'Inschrijving', title_en: 'Registration'
    }
  }

  for (const page of pages) {
    const update = pageUpdates[page.slug]
    if (!update) {
      log.push(`SKIP: Unknown page slug "${page.slug}"`)
      continue
    }

    await (db as any).update(pagesPages)
      .set({
        title: update.title_fr,
        content: update.fr,
        translations: {
          en: { title: update.title_en, content: update.en },
          fr: { title: update.title_fr, content: update.fr },
          nl: { title: update.title_nl, content: update.nl }
        },
        updatedAt: new Date()
      })
      .where(eq(pagesPages.id as any, page.id))

    log.push(`UPDATED: ${page.slug} — fr/nl/en content set (TipTap JSON)`)
  }

  return { success: true, summary: log }
})
