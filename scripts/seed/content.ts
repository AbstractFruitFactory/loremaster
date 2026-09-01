import type { DocumentType } from '#lib/document.js'

export type SeedDocument = {
	path: string
	type: DocumentType
	aliases?: string[]
	content: string
	eventKey?: string
	afterEventKey?: string
}

export const seedDocumentSummary = ({ content }: Pick<SeedDocument, 'content'>) => {
	const paragraph = content
		.split(/\r?\n\s*\r?\n/)
		.map((section) => section.trim())
		.find((section) => section && !section.startsWith('#') && !section.startsWith('-'))

	if (!paragraph) {
		throw new Error('Seed document has no descriptive paragraph')
	}

	return paragraph
		.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1')
		.replace(/\[\[([^\]]+)\]\]/g, '$1')
		.replace(/\s+/g, ' ')
		.trim()
}

export const seedCampaign = {
	id: '11111111-1111-4111-8111-111111111111',
	name: 'The Bell Beneath Blackwater',
	description:
		'A rain-soaked mystery beneath Greyhaven, where a drowned city, thirteen forbidden tones, and an ancient presence wait below the Blackwater.'
}

export const seedDocuments: SeedDocument[] = [
	{
		path: 'Locations/Greyhaven.md',
		type: 'location',
		content: `# Greyhaven

A river city built over older, deeper structures. Thirty-one years ago, the [[Blackwater Flood]] destroyed most of its lower city, leaving the [[Flooded District]] largely abandoned.

## Districts and landmarks

- [[The Crooked Lantern]]
- [[Saint Orra's Chapel]]
- [[Old Customs House]]
- [[Vey's Remedies]]
- The northern district, where [[Ilyra Vey]] keeps a safe place`
	},
	{
		path: 'Locations/The-Crooked-Lantern.md',
		type: 'location',
		aliases: ['Crooked Lantern'],
		content: `# The Crooked Lantern

A Greyhaven inn run by [[Old Bren]]. The party stayed here after arriving in the city and met [[Mara Vale]] over breakfast on the morning of their expedition.`
	},
	{
		path: 'Locations/Flooded-District.md',
		type: 'location',
		content: `# Flooded District

Most of Greyhaven's lower city has stood abandoned since the [[Blackwater Flood]]. Rainwater lies ankle-deep near [[Saint Orra's Chapel]] and grows deeper toward the river.

## Known sites

- [[Vey's Remedies]]
- [[Saint Orra's Chapel]]
- [[Old Customs House]]`
	},
	{
		path: 'Locations/Saint-Orra-Chapel.md',
		type: 'location',
		aliases: ["Saint Orra's Chapel"],
		content: `# Saint Orra's Chapel

An old chapel in the [[Flooded District]]. Its front doors are chained, but a graveyard surrounds it and a locked drainage entrance lies behind it.

## Graveyard

Roughly thirty weathered graves stand here. The newest belongs to [[Brother Edric Vale]] and bears the epitaph, “He heard the deep places singing.”

## Drainage entrance

An iron grate behind the chapel opens into the [[Drainage Tunnels]]. Recent scratches, inward-dragged mud, and a fresh boot print showed that someone entered one or two days before the party.`
	},
	{
		path: 'Locations/Veys-Remedies.md',
		type: 'location',
		aliases: ["Vey's Remedies"],
		content: `# Vey's Remedies

An abandoned apothecary across the street from [[Saint Orra's Chapel]]. Its sign barely hangs on. A hooded [[Ilyra Vey]] watched the party from a second-story window here before disappearing from sight.

The shared surname links the shop to [[Elias Vey]], though the exact history of the business is unknown.`
	},
	{
		path: 'Locations/Drainage-Tunnels.md',
		type: 'location',
		content: `# Drainage Tunnels

Smuggling tunnels beneath [[Saint Orra's Chapel]] that predate the rising river. [[Mara Vale]] once used them to move stolen goods.

At a fork, Mara's map directs travelers left toward the [[Blackwater Cistern]]. The right-hand passage leads to a flooded chamber where the party found [[Nell]]. A dry alcove lies about ten minutes from the chapel entrance.`
	},
	{
		path: 'Locations/Old-Customs-House.md',
		type: 'location',
		aliases: ['Greyhaven Customs House', 'Customs House'],
		content: `# Old Customs House

An abandoned customs building in the [[Flooded District]]. The [[Blackwater Cistern]] and a dry records room lie beneath it.

In 623, the Greyhaven customs office made recurring payments to the [[Office of Subterranean Works]].`
	},
	{
		path: 'Locations/Blackwater-Cistern.md',
		type: 'location',
		aliases: ['Cistern'],
		content: `# Blackwater Cistern

A large circular chamber beneath the [[Old Customs House]]. Stone walkways surround black water, and the [[Cistern Bell]] hangs from a wooden frame on the central platform.

## Discoveries

- An eyeless adult corpse bearing the [[Three-Pointed Crown]]
- A dry records room behind a locked iron door
- The [[Subterranean Works Ledger]]
- The [[Silver Lockbox]]
- A passage leading deeper toward the [[Lower Gate]]`
	},
	{
		path: 'Locations/Lower-Gate.md',
		type: 'location',
		content: `# Lower Gate

A sealed structure beneath the [[Blackwater Cistern]]. [[Magistrate Corven]] ordered it closed in 623 and prohibited further excavation.

The [[Black Iron Key]] opens it. When [[Ilyra Vey]] saw the key, she said that the presence below knew the party had it.`
	},
	{
		path: 'Locations/Blackwater.md',
		type: 'location',
		content: `# Blackwater

The river and flooded depths beneath [[Greyhaven]]. The [[Blackwater Flood]] took the lower city, and something enormous now moves in the water beneath the [[Blackwater Cistern]].`
	},
	{
		path: 'NPCs/Mara-Vale.md',
		type: 'npc',
		aliases: ['Mara'],
		content: `# Mara Vale

A Greyhaven smuggler, about forty years old, and daughter of [[Brother Edric Vale]]. She knows a route through the [[Drainage Tunnels]] beneath [[Saint Orra's Chapel]].

## Deal with the party

Mara gave the party [[Mara's Charcoal Map|a charcoal tunnel map]] and asked them to recover the [[Silver Lockbox]] unopened. She warned them not to ring any bells underground.

## Conflicting claims

[[Ilyra Vey]] says Mara has searched for the box for six years and that others Mara sent into the tunnels died. Ilyra believes Mara wants the work of her father because he sought a way to return people drowned in the [[Blackwater Flood]].`
	},
	{
		path: 'NPCs/Old-Bren.md',
		type: 'npc',
		aliases: ['Bren', 'The Innkeeper'],
		content: `# Old Bren

The innkeeper of [[The Crooked Lantern]]. He should not be confused with [[Mara Vale]], the smuggler.`
	},
	{
		path: 'NPCs/Brother-Edric-Vale.md',
		type: 'npc',
		aliases: ['Edric Vale', 'Edric'],
		content: `# Brother Edric Vale

A religious scholar who lived from 611 to 647 and was the father of [[Mara Vale]]. His grave at [[Saint Orra's Chapel]] reads, “He heard the deep places singing.”

Edric corresponded with [[Elias Vey]] about the ancient presence beneath [[Greyhaven]]. He rejected the legend's literal interpretation: “It is not a king. That is only the shape our stories gave it.” He warned Elias never to complete the [[Thirteen Tones]].

His cold [[Edric's Brass Bell|brass bell]] was left on his headstone.`
	},
	{
		path: 'NPCs/Nell.md',
		type: 'npc',
		content: `# Nell

About ten years old, Nell was found barefoot and soaked in a chamber within the [[Drainage Tunnels]]. She said her brother [[Tomas]] brought her underground to find treasure before the [[Eyeless Singer]] took him.

Nell recognized [[Edric's Brass Bell]] and recoiled from it, but refused to explain how she knew it. She identified the [[Three-Pointed Crown]] as the mark of the [[Drowned King]].

After the party escorted her to [[Saint Orra's Chapel]], she disappeared and left a chalk message on the chapel door: “Tomas is below.”`
	},
	{
		path: 'NPCs/Tomas.md',
		type: 'npc',
		content: `# Tomas

Nell's missing brother. He brought [[Nell]] into the [[Drainage Tunnels]] looking for treasure and was taken by the [[Eyeless Singer]].

The party did not find Tomas. Nell's final message said that he was still below.`
	},
	{
		path: 'NPCs/Elias-Vey.md',
		type: 'npc',
		aliases: ['E. Vey'],
		content: `# Elias Vey

Grandfather of [[Ilyra Vey]] and father of [[Seraphine Vey]]. He received recurring payments from the [[Office of Subterranean Works]] and helped construct the bells beneath [[Greyhaven]].

Unlike [[Brother Edric Vale]], Elias believed the ancient presence could be controlled. He insisted that the bell mechanism remain when [[Magistrate Corven]] sealed the [[Lower Gate]].

His final known letter said, “Seraphine has agreed. The lower gate will open on the night of the red tide.” It was dated three days after Seraphine drowned.`
	},
	{
		path: 'NPCs/Seraphine-Vey.md',
		type: 'npc',
		aliases: ['Seraphine'],
		content: `# Seraphine Vey

Daughter of [[Elias Vey]] and aunt of [[Ilyra Vey]]. She drowned twenty-nine years ago, two years after the [[Blackwater Flood]].

Elias wrote that Seraphine had agreed to open the [[Lower Gate]] three days after her death. Her name was also written repeatedly on a scrap carried by the dead crowned man in the [[Blackwater Cistern]].`
	},
	{
		path: 'NPCs/Ilyra-Vey.md',
		type: 'npc',
		aliases: ['Ilyra', 'The Hooded Woman'],
		content: `# Ilyra Vey

A woman in her late twenties with dark hair and a scar across her chin. She is the granddaughter of [[Elias Vey]] and niece of [[Seraphine Vey]].

Ilyra followed the party through the [[Flooded District]], first watching from [[Vey's Remedies]]. She entered the [[Blackwater Cistern]] after the party opened the [[Silver Lockbox]] and led them to safety when the bells began ringing.

She distrusts [[Mara Vale]] and offered to explain more at a safe place in Greyhaven's northern district.`
	},
	{
		path: 'NPCs/Magistrate-Corven.md',
		type: 'npc',
		aliases: ['Corven'],
		content: `# Magistrate Corven

A Greyhaven magistrate who ordered the [[Lower Gate]] sealed in 623, ended further excavation, and permitted [[Elias Vey]] to retain the bell mechanism.

Corven died around eight years before the party's expedition.`
	},
	{
		path: 'NPCs/Captain-Harl.md',
		type: 'npc',
		content: `# Captain Harl

The party acquired the [[Captain Harl's Key|key]] from Captain Harl before this session. It does not open the drainage grate at [[Saint Orra's Chapel]], but it does open the crowned records room beneath the [[Old Customs House]].`
	},
	{
		path: 'NPCs/Eyeless-Singer.md',
		type: 'npc',
		aliases: ['Singing Man', 'The Singing Man'],
		content: `# Eyeless Singer

A pale humanoid with no eyes and a mouth that opens far too wide. Its song can charm listeners and draw them toward the [[Cistern Bell]].

It took [[Tomas]] and later attacked the party in the [[Blackwater Cistern]]. Theo shoved it into the black water, but as it fell it pulled the bell rope and sounded the [[First Tone]]. Its survival is unknown.`
	},
	{
		path: 'Players/Theo.md',
		type: 'player',
		content: `# Theo

Theo's character is an inquisitive adventurer who inspected [[Mara's Charcoal Map]], discovered the faint [[Three-Pointed Crown]], and identified recent tracks at the chapel grate.

## Current possessions

- [[Edric's Brass Bell]]
- [[Black Iron Key]]
- The opened [[Silver Lockbox]]
- A length of wet rope cut from the [[Cistern Bell]]

Theo broke Sam's character free of the [[Eyeless Singer|Eyeless Singer's]] charm and pushed the creature into the water.`
	},
	{
		path: 'Players/Jess.md',
		type: 'player',
		content: `# Jess

Jess's character keeps a notebook, copied the [[Three-Pointed Crown]], picked the lock on the chapel drainage grate, and escorted [[Nell]] back to the chapel.

A perfect Arcana inspection revealed that the [[Cistern Bell]] is a conduit through which something elsewhere listens. During the fight, Jess struck the [[Eyeless Singer]] with Guiding Bolt.`
	},
	{
		path: 'Players/Sam.md',
		type: 'player',
		content: `# Sam

Sam's character favored rescuing [[Nell]] and opened the crowned records room using [[Captain Harl's Key]]. During the fight in the [[Blackwater Cistern]], the [[Eyeless Singer]] briefly charmed Sam toward the bell before Theo broke the effect.`
	},
	{
		path: 'Items/Maras-Charcoal-Map.md',
		type: 'item',
		aliases: ["Mara's Map", 'Charcoal Map', 'Charcoal Tunnel Map'],
		content: `# Mara's Charcoal Map

A rough map given to the party by [[Mara Vale]]. It marks [[Saint Orra's Chapel]], the entrance to the [[Drainage Tunnels]], and the [[Blackwater Cistern]] beneath the [[Old Customs House]].

The map directs travelers left at the underground fork. A faint [[Three-Pointed Crown]] is scratched beside the cistern.`
	},
	{
		path: 'Items/Edric-Brass-Bell.md',
		type: 'item',
		aliases: ["Edric's Bell", 'Brass Bell'],
		content: `# Edric's Brass Bell

A small brass bell found on [[Brother Edric Vale|Edric's]] grave. It felt much colder than the rain.

[[Nell]] recognized it and covered her ears when Theo produced it. Later, while inside Theo's backpack, it rang twice by itself after the [[Silver Lockbox]] was opened.`
	},
	{
		path: 'Items/Cistern-Bell.md',
		type: 'item',
		aliases: ['Bronze Bell', 'Large Bell'],
		content: `# Cistern Bell

An old bronze bell suspended above the central platform in the [[Blackwater Cistern]]. It is not conventionally enchanted; it acts as a conduit through which something elsewhere listens.

The [[Eyeless Singer]] rang it once while falling into the water. The tone extinguished every flame in the cistern. Theo then cut away its rope.`
	},
	{
		path: 'Items/Silver-Lockbox.md',
		type: 'item',
		aliases: ['E.V. Lockbox', 'Lockbox'],
		content: `# Silver Lockbox

A silver box marked with the initials E.V. and sealed in wax with the [[Three-Pointed Crown]]. [[Mara Vale]] asked the party to return it unopened, but a warning note claimed that Mara lied and the box belonged to the dead.

## Contents

- Letters between [[Elias Vey]] and [[Brother Edric Vale]]
- The [[Black Iron Key]]
- The [[Vial of Seawater]]

The party broke the seal and retained the opened box.`
	},
	{
		path: 'Items/Black-Iron-Key.md',
		type: 'item',
		content: `# Black Iron Key

A key found inside the [[Silver Lockbox]]. [[Ilyra Vey]] identified it as the key to the [[Lower Gate]]. The small bells began ringing after it was revealed.`
	},
	{
		path: 'Items/Vial-of-Seawater.md',
		type: 'item',
		aliases: ['Seawater Vial'],
		content: `# Vial of Seawater

A small glass vial apparently containing seawater, found inside the [[Silver Lockbox]]. Its purpose is unknown.`
	},
	{
		path: 'Items/Captain-Harls-Key.md',
		type: 'item',
		aliases: ["Harl's Key"],
		content: `# Captain Harl's Key

A key acquired from [[Captain Harl]]. It did not fit the drainage grate behind [[Saint Orra's Chapel]], but it opened the iron door to the records room beneath the [[Old Customs House]].`
	},
	{
		path: 'Items/Subterranean-Works-Ledger.md',
		type: 'item',
		aliases: ['623 Ledger', 'Customs Ledger'],
		content: `# Subterranean Works Ledger

A ledger dated 623, found in the dry records room beneath the [[Old Customs House]].

It records recurring payments from the Greyhaven customs office to the [[Office of Subterranean Works]], including payments to [[Elias Vey]]. Its final entry reads: “Lower gate sealed by order of Magistrate Corven. Bell mechanism retained at the insistence of E. Vey. No further excavation permitted.”`
	},
	{
		path: 'Items/Crowned-Warning.md',
		type: 'item',
		aliases: ['Warning Note'],
		content: `# Crowned Warning

A folded note left just inside the chapel drainage entrance while Jess escorted [[Nell]] out of the tunnels.

It reads, “Mara lies. The box belongs to the dead,” and is signed only with the [[Three-Pointed Crown]].`
	},
	{
		path: 'Lore/Drowned-King.md',
		type: 'lore',
		content: `# Drowned King

A Greyhaven folktale about a king beneath the city who will wake when the bells ring thirteen times. [[Nell]] learned the story from her mother.

[[Brother Edric Vale]] believed the legend gave a familiar shape to something that was not truly a king. His letters describe a sequence of [[Thirteen Tones]], not merely thirteen bell strikes.`
	},
	{
		path: 'Lore/Three-Pointed-Crown.md',
		type: 'lore',
		aliases: ['Crowned Mark', 'Crown Symbol'],
		content: `# Three-Pointed Crown

A symbol associated with the [[Drowned King]] and the works beneath [[Greyhaven]].

It appears beside the cistern on [[Mara's Charcoal Map]], on the [[Crowned Warning]], tattooed on the dead man's wrist, carved above the records-room door, and in the wax seal of the [[Silver Lockbox]].`
	},
	{
		path: 'Lore/Thirteen-Tones.md',
		type: 'lore',
		aliases: ['Thirteen Bells', 'Bell Sequence'],
		content: `# Thirteen Tones

A forbidden sequence created by [[Elias Vey]] and [[Brother Edric Vale]] to communicate with the presence beneath [[Greyhaven]]. Edric warned that the sequence must never be completed.

The old folk story says the [[Drowned King]] wakes after thirteen bells, but the recovered letters specifically call them tones.

## Current count

Four tones sounded during the expedition.`
	},
	{
		path: 'Lore/Office-of-Subterranean-Works.md',
		type: 'lore',
		aliases: ['Subterranean Works'],
		content: `# Office of Subterranean Works

An organization paid by the Greyhaven customs office to conduct work beneath the city. [[Elias Vey]] was a recurring recipient.

In 623, [[Magistrate Corven]] ordered its excavation halted and the [[Lower Gate]] sealed, though the bell mechanism was retained.`
	},
	{
		path: 'Lore/Blackwater-Flood.md',
		type: 'lore',
		aliases: ['The Flood'],
		content: `# Blackwater Flood

A disaster thirty-one years before the current session that destroyed most of lower [[Greyhaven]] and created the present [[Flooded District]].

[[Mara Vale]] was a child at the time. Her father, [[Brother Edric Vale]], later sought a way to return those who drowned. [[Seraphine Vey]] drowned two years after the flood.`
	},
	{
		path: 'Lore/Red-Tide.md',
		type: 'lore',
		content: `# Red Tide

An event named in the final known letter from [[Elias Vey]]: “Seraphine has agreed. The lower gate will open on the night of the red tide.”

The meaning and timing of the red tide are unknown.`
	},
	{
		path: 'Sessions/The-Bell-Beneath-Blackwater.md',
		type: 'session',
		aliases: ['Blackwater Session'],
		content: `# The Bell Beneath Blackwater

The morning after arriving in [[Greyhaven]], the party met [[Mara Vale]] at [[The Crooked Lantern]]. She gave them [[Mara's Charcoal Map]] and asked them to retrieve the [[Silver Lockbox]] from beneath the [[Old Customs House]] without opening it.

## Saint Orra's Chapel

In the [[Flooded District]], the party noticed [[Ilyra Vey|a hooded watcher]] at [[Vey's Remedies]]. At [[Saint Orra's Chapel]], they found [[Brother Edric Vale|Edric's]] grave and took [[Edric's Brass Bell]]. Recent tracks showed that another person had entered the [[Drainage Tunnels]].

## Nell and Tomas

The party followed crying away from Mara's route and found [[Nell]]. She said the [[Eyeless Singer]] had taken her brother [[Tomas]]. Jess escorted her to the chapel and found the [[Crowned Warning]]. Nell explained the [[Drowned King]] legend and later vanished, leaving “Tomas is below” on the chapel door.

## The cistern

In the [[Blackwater Cistern]], the party found the [[Cistern Bell]], a crowned corpse, and the [[Eyeless Singer]]. The creature charmed Sam toward the bell, but Theo broke the charm and shoved it into the water. It pulled the rope as it fell, sounding the [[First Tone]].

## The lockbox

Using [[Captain Harl's Key]], the party entered a dry records room containing the [[Subterranean Works Ledger]] and the [[Silver Lockbox]]. They opened the box and learned that [[Elias Vey]] and [[Brother Edric Vale]] built the bells to communicate with an ancient presence below the city.

[[Ilyra Vey]] arrived, revealed her connection to Elias and [[Seraphine Vey]], and led the party out after [[Edric's Brass Bell]] rang twice. A fourth tone followed during their escape.

## End state

- The [[Thirteen Tones|bell count]] is four
- [[Tomas]] remains below
- The party has the [[Black Iron Key]] to the [[Lower Gate]]
- The party is following Ilyra to a safe place
- Ilyra refuses to go near [[Mara Vale]]

## Raw transcript

DM: Alright, picking up the morning after you arrived in Greyhaven. It’s raining pretty heavily. You’re staying at the Crooked Lantern, and when you come downstairs, Mara is already awake and eating breakfast.

Theo: Is Mara the innkeeper?

DM: No, Mara Vale. The smuggler you met last session. Innkeeper is Old Bren.

Theo: Right, right.

Jess: I sit down across from Mara. “You said you knew another way into the flooded district?”

DM: She looks around before answering. “There’s a drainage tunnel under Saint Orra’s Chapel. Used to move things through there before the river rose.”

Sam: “Things?”

DM: She smiles. “Things that didn’t belong to us.”

Jess: I like her.

DM: She says the tunnel should take you underneath the old customs house, but she warns you not to ring any bells you find down there.

Theo: That is an incredibly suspiciously specific warning.

Sam: I ask why.

DM: Mara gets serious. “Because the last man who did never came back. We heard the bell three more times after he disappeared.”

Jess: Cool. Hate that.

DM: She gives you a rough charcoal map. It shows Saint Orra’s Chapel, the drainage entrance, and a mark underneath the customs house labelled only “Cistern.”

Theo: I want to inspect the map. Any hidden markings?

DM: Investigation?

Theo: 18.

DM: There’s something scratched very faintly beside the cistern. Looks like a little crown with three points.

Theo: Do I recognize it?

DM: Not immediately.

Sam: Can I roll History?

DM: Sure.

Sam: Nine.

DM: Nope.

Jess: I draw it in my notebook.

DM: Great. Mara says she wants one thing in return: if you find a silver lockbox marked with the initials E.V., bring it back unopened.

Theo: Absolutely going to open that.

Jess: We agree not to open it.

Theo: I agree out loud not to open it.

DM: You head toward Saint Orra’s Chapel. The flooded district is mostly abandoned. Water is maybe ankle-deep here, but deeper toward the river. As you approach the chapel, you notice someone watching you from a second-story window across the street.

Sam: Humanoid?

DM: Human, probably. Hooded. They disappear when you look directly at them.

Jess: I want to go check the building.

Theo: We have a haunted tunnel to get to.

Jess: Someone is following us!

Sam: Maybe we split—

Everyone: NO.

DM: Sensible.

Jess: Fine. I mark the building. What is it?

DM: An old apothecary called Vey’s Remedies. Sign is barely hanging on.

Jess: Remember that.

DM: The chapel doors are chained, but Mara’s map shows an entrance around the back.

Theo: I check the graveyard first.

DM: There are maybe thirty graves. Most are too weathered to read. One newer grave stands out: Brother Edric Vale, 611–647. “He heard the deep places singing.”

Sam: Vale? Same surname as Mara?

DM: Yep.

Jess: Ohhhh.

Theo: Do we know if they’re related?

DM: You don’t.

Theo: Yet.

Sam: I inspect the grave.

DM: The soil hasn’t been disturbed recently. But there’s a small brass bell resting on the headstone.

Everyone: Nope.

Jess: Do not touch it.

Theo: I touch it without ringing it.

DM: It’s cold. Much colder than the rain.

Theo: Pocket it.

Jess: WHY.

DM: Add Brother Edric’s brass bell to your inventory.

DM: Behind the chapel you find an iron grate partly submerged in runoff. It’s locked.

Sam: I use the key we got from Captain Harl.

DM: Doesn’t fit.

Jess: Thieves’ tools. Seventeen.

DM: You open it.

Theo: Does it look like someone has used it recently?

DM: Good question. Survival or Investigation.

Theo: 21 Investigation.

DM: Yes. Scratches on the lock, mud dragged inward, and a boot print. Fairly recent. Maybe within a day or two.

Sam: So someone went in before us.

DM: You descend into the drainage tunnel. After about ten minutes, you reach a fork. Mara’s map says left, but you can hear faint crying from the right-hand tunnel.

Jess: Child crying?

DM: Sounds like a young girl.

Theo: Obviously monster.

Sam: Obviously rescue mission.

Jess: We go right.

Theo: I hate democracy.

DM: The crying leads to a chamber where you find a girl sitting knee-deep in water. Maybe ten years old. Brown dress, barefoot, soaked through.

Sam: I approach carefully. “What’s your name?”

DM: “Nell.”

Jess: Insight.

DM: Roll.

Jess: 14.

DM: She seems genuinely frightened.

Theo: “How did you get down here?”

DM: “My brother brought me. He said there was treasure.”

Sam: “Where is he?”

DM: Nell points toward a narrow doorway. “The singing man took him.”

Theo: Excuse me?

Jess: What singing man?

DM: She says, “He has no eyes.”

Theo: Great.

Sam: We get her out first.

Jess: We can’t walk her all the way back.

Theo: There was that dry alcove ten minutes ago.

Sam: Absolutely not leaving the horror-movie child alone.

DM: While you argue, Nell looks at Theo and says, “You have his bell.”

Theo: …

Jess: OH COME ON.

Theo: “Whose bell?”

DM: She just points at your bag.

Theo: I take out Edric’s bell, but very carefully.

DM: Nell immediately backs away and covers her ears.

Theo: I put it away.

Sam: Did she know Edric?

DM: She refuses to answer.

DM: Eventually you decide Jess will escort Nell back to the chapel entrance while Theo and Sam wait.

Jess: I’m watching for the hooded person.

DM: You don’t see anyone, but when you reach the grate, there is now a folded piece of paper sitting just inside the entrance.

Jess: I open it.

DM: It says: “Mara lies. The box belongs to the dead.”

Jess: Any signature?

DM: Just the same three-pointed crown symbol from the map.

Jess: Ohhh.

DM: Nell sees the symbol and says, “That’s the drowned king.”

Jess: I ask her what that means.

DM: She says her mother used to tell her stories about a king beneath Greyhaven who would wake when the bells rang thirteen times.

Jess: How many times have bells rung?

DM: As far as you know? None today.

Jess: Comforting.

DM: You leave Nell in the chapel vestibule after she insists she can find her way home once the rain stops.

Jess: I give her two silver.

DM: She hugs you and says her brother’s name is Tomas.

DM: You regroup and continue toward the customs house.

Theo: I tell them about the note?

Jess: I tell them everything except the “drowned king wakes after thirteen bells” part.

Sam: Why?

Jess: Because my character doesn’t want to freak Theo out.

Theo: Incredible.

DM: Eventually you enter a large circular cistern beneath the customs house. There are stone walkways around black water. In the center is a platform with an old bronze bell hanging from a wooden frame.

Everyone: There it is.

DM: Beneath the bell is a body.

Sam: Tomas?

DM: Older. Adult male.

Theo: I inspect him.

DM: He’s been dead maybe two days. His eyes have been removed.

Jess: Do we recognize him?

DM: No. He has a tattoo on his wrist: three-pointed crown.

Sam: Search the body.

DM: You find twelve copper coins, a rusted knife, and a scrap of paper with the name “Seraphine” written repeatedly.

Theo: Any silver box?

DM: Not here.

Jess: Can I inspect the bell without touching it?

DM: Arcana.

Jess: Natural 20.

DM: The bell is magical, but not in the way you normally recognize. It doesn’t seem enchanted itself. More like it’s a conduit. Something elsewhere is listening through it.

Theo: That’s cool.

Sam: Can we destroy it?

DM: Probably.

Theo: Absolutely not until we know what it does.

DM: As you’re investigating, Sam hears splashing behind you.

Sam: I turn.

DM: A humanoid figure pulls itself out of the water. Pale skin, no eyes, mouth open far too wide. And it begins singing.

Theo: Is this the singing man?

DM: Probably!

Jess: Initiative.

DM: During the fight, the creature uses the song to charm Sam, who starts walking toward the bell.

Sam: Do I get another save if someone hits me?

DM: Yes.

Theo: I slap Sam.

Sam: Rude.

Theo: Non-lethal friendship damage.

DM: You break the charm.

Jess: I cast Guiding Bolt. Twenty-two to hit.

DM: Hits. Big damage. The creature shrieks, and the black water around the platform starts bubbling.

Theo: I’m going to shove it back into the water.

DM: Athletics.

Theo: 19.

DM: You push it in. As it falls, it grabs the bell rope.

Everyone: NO.

DM: The bell rings once.

Jess: Oh shit.

DM: The sound is impossibly deep. You feel it in your chest more than hear it. Every flame in the room goes out.

Sam: How many was it? One?

DM: One.

Jess: My character suddenly tells everyone about the thirteen bells.

Theo: THANK YOU.

DM: The creature disappears beneath the water. Combat ends.

Sam: Did we kill it?

DM: You don’t know.

Theo: I cut the bell rope.

DM: Done.

Jess: Good.

Theo: Then I take the rope.

Jess: Why?

Theo: Might be magic.

DM: It’s wet rope.

Theo: Treasure.

DM: Behind the central platform you find a locked iron door. The symbol of the three-pointed crown is carved above it.

Jess: Any keyhole?

DM: Yes.

Sam: Captain Harl’s key?

DM: It fits.

Theo: Interesting.

Sam: Very interesting.

DM: Inside is a small records room that somehow stayed dry. Most papers have rotted, but you find a ledger from 623, around twenty-four years ago.

Jess: Anything about the drowned king?

DM: Not directly. But there are payments recorded from the Greyhaven customs office to something called the Office of Subterranean Works.

Theo: Sounds normal and not ominous.

DM: One recurring recipient is Elias Vey.

Jess: E.V.

Sam: The lockbox.

DM: Maybe.

Theo: Is Vey related to Vey’s Remedies?

DM: Same surname.

Jess: Apothecary watcher!

DM: The final ledger entry says: “Lower gate sealed by order of Magistrate Corven. Bell mechanism retained at the insistence of E. Vey. No further excavation permitted.”

Sam: Is Corven still alive?

DM: You know Magistrate Corven died about eight years ago.

DM: You also find the silver lockbox Mara asked for.

Theo: OPEN IT.

Jess: We promised.

Sam: We also have a note saying Mara lies.

Theo: Democracy?

Jess: Fine. Vote.

Sam: Open.

Theo: Open.

Jess: I hate both of you. Open.

DM: The box has a wax seal with the three-pointed crown. Theo breaks it.

Theo: Happily.

DM: Inside are three things: a bundle of letters, a black iron key, and a small glass vial containing seawater.

Sam: Seawater?

DM: You think so.

Jess: Letters first.

DM: They’re correspondence between Elias Vey and Brother Edric Vale.

Theo: Ohhh.

DM: From what you can piece together, Edric believed something ancient was buried underneath Greyhaven. Elias thought it could be controlled. They constructed the bells as a way to communicate with it.

Sam: Smart.

DM: One letter from Edric says: “It is not a king. That is only the shape our stories gave it.”

Jess: Nice.

Theo: Anything about thirteen?

DM: Another letter warns Elias never to complete the sequence of thirteen tones.

Jess: Tones, not bells?

DM: Specifically tones.

Theo: That sounds important.

DM: The last letter is from Elias. It says: “Seraphine has agreed. The lower gate will open on the night of the red tide.”

Sam: Seraphine again.

Jess: Do we know who that is?

DM: Not yet.

DM: Then you hear footsteps in the cistern.

Theo: We hide.

DM: A woman enters carrying a lantern. Same hooded figure you saw earlier.

Jess: I knew it.

DM: She calls out: “If you opened the box, we need to leave. Now.”

Sam: “Who are you?”

DM: She pulls down the hood. She’s maybe late twenties, dark hair, scar across her chin. “My name is Ilyra Vey. Elias was my grandfather.”

Theo: “Why were you following us?”

DM: “Because Mara Vale has been looking for that box for six years, and anyone she sends into these tunnels usually dies.”

Jess: We ask why Mara wants it.

DM: Ilyra says, “Because Edric Vale was her father.”

Everyone: Ahhhhh.

Theo: Called it.

DM: She claims Mara believes Edric discovered a way to bring back people who drowned in the Blackwater flood.

Sam: When was the flood?

DM: Thirty-one years ago. It destroyed most of the lower city.

Jess: Mara isn’t old enough—

DM: Mara is about forty.

Jess: Okay, so she would have been a child.

DM: Correct.

Theo: I show Ilyra the black key.

DM: She goes pale and asks where you got it.

Theo: “Box.”

DM: She says it opens the Lower Gate.

Sam: Where is that?

DM: Beneath the cistern.

Jess: Obviously.

Theo: Ask her about Seraphine.

DM: Ilyra hesitates. Then says, “Seraphine Vey was Elias’s daughter. My aunt.”

Sam: Was?

DM: “She drowned twenty-nine years ago.”

Jess: AFTER the flood.

DM: Yep.

Theo: And Elias was talking to her in the letter?

DM: The letter was dated three days after her death.

Sam: Nope.

DM: Before you can ask more, the bell rings.

Jess: We cut the rope!

DM: The large bell doesn’t move.

Theo: Edric’s bell.

DM: From inside your backpack, the small brass bell rings by itself.

Theo: I throw the bag.

DM: It rings again.

Sam: That’s three total.

DM: Correct.

Jess: Does Ilyra react?

DM: She whispers, “It knows you have the key.”

Theo: Great.

DM: And beneath your feet, something enormous moves in the water.

Sam: Run?

Jess: RUN.

DM: You escape the cistern with Ilyra. As you’re climbing back toward the chapel, you hear one final bell behind you.

Theo: Four.

DM: Four.

Jess: Does the little bell ring or the big one?

DM: You can’t tell.

DM: Back outside, the rain has stopped. Nell is gone.

Sam: Did she leave anything?

DM: Yes. Written in chalk on the chapel door is: “Tomas is below.”

Jess: She said the singing man took him.

Theo: So we never found him.

Sam: Next session objective.

DM: Ilyra says she has a safe place where you can talk, but she refuses to go anywhere near Mara.

Jess: Do we go with Ilyra or confront Mara?

Theo: I want to confront Mara immediately.

Sam: Ilyra first. We need information.

Jess: Ilyra.

DM: Alright. You follow Ilyra toward the northern district.

Theo: Before we leave, I check my bag.

DM: The brass bell is still there.

Theo: And the black key?

DM: Still there.

Theo: Silver box?

DM: You have it too.

Jess: We absolutely should not show Mara that we opened it.

Theo: The broken seal may be a clue.

Sam: We can lie.

DM: And that’s where we’ll end.

Theo: How many bells?

DM: Four.

Jess: Please write that down.`
	},
	{
		path: 'Events/Flood-Devastates-Greyhaven.md',
		type: 'event',
		eventKey: 'flood',
		content: `# Flood Devastates Greyhaven

Thirty-one years before the current expedition, floodwaters destroyed most of lower [[Greyhaven]]. The disaster left the [[Flooded District]] abandoned and inspired stories of the [[Drowned King]].`
	},
	{
		path: 'Events/Seraphine-Drowns.md',
		type: 'event',
		eventKey: 'seraphine-drowns',
		afterEventKey: 'flood',
		content: `# Seraphine Drowns

Two years after the [[Blackwater Flood]], [[Seraphine Vey]] drowned. Three days later, [[Elias Vey]] wrote that she had agreed to open the [[Lower Gate]] on the night of the [[Red Tide]].`
	},
	{
		path: 'Events/Lower-Gate-Sealed.md',
		type: 'event',
		eventKey: 'gate-sealed',
		afterEventKey: 'seraphine-drowns',
		content: `# Lower Gate Sealed

In 623, [[Magistrate Corven]] ordered the [[Lower Gate]] sealed and prohibited further excavation. At [[Elias Vey|Elias Vey's]] insistence, the bell mechanism remained in place.`
	},
	{
		path: 'Events/Edric-Dies.md',
		type: 'event',
		eventKey: 'edric-dies',
		afterEventKey: 'gate-sealed',
		content: `# Edric Dies

[[Brother Edric Vale]] died in 647 and was buried at [[Saint Orra's Chapel]]. His epitaph reads, “He heard the deep places singing,” and his [[Edric's Brass Bell|brass bell]] was left on the headstone.`
	},
	{
		path: 'Events/Crowned-Man-Dies.md',
		type: 'event',
		eventKey: 'crowned-man-dies',
		afterEventKey: 'edric-dies',
		content: `# Crowned Man Dies

About two days before the party entered the tunnels, an unidentified man died beneath the [[Cistern Bell]]. His eyes were removed, a [[Three-Pointed Crown]] was tattooed on his wrist, and he carried a scrap repeatedly bearing the name [[Seraphine Vey|Seraphine]].`
	},
	{
		path: 'Events/Into-the-Drainage-Tunnels.md',
		type: 'event',
		eventKey: 'tunnel-expedition',
		afterEventKey: 'crowned-man-dies',
		content: `# Into the Drainage Tunnels

The party entered the [[Drainage Tunnels]] using [[Mara's Charcoal Map]]. They found [[Nell]], learned that [[Tomas]] had been taken, and received the [[Crowned Warning]] before proceeding to the [[Blackwater Cistern]].`
	},
	{
		path: 'Events/First-Tone.md',
		type: 'event',
		eventKey: 'first-tone',
		afterEventKey: 'tunnel-expedition',
		content: `# First Tone

During the fight in the [[Blackwater Cistern]], the [[Eyeless Singer]] grabbed the rope of the [[Cistern Bell]] as Theo pushed it into the water.

The bell rang once with an impossibly deep tone, and every flame in the chamber went out.`
	},
	{
		path: 'Events/Lockbox-Opened.md',
		type: 'event',
		eventKey: 'lockbox-opened',
		afterEventKey: 'first-tone',
		content: `# Lockbox Opened

The party broke the crowned wax seal on the [[Silver Lockbox]]. Inside they found letters between [[Elias Vey]] and [[Brother Edric Vale]], the [[Black Iron Key]], and the [[Vial of Seawater]].`
	},
	{
		path: 'Events/Second-and-Third-Tones.md',
		type: 'event',
		eventKey: 'third-tone',
		afterEventKey: 'lockbox-opened',
		content: `# Second and Third Tones

After [[Ilyra Vey]] identified the [[Black Iron Key]], [[Edric's Brass Bell]] rang twice by itself inside Theo's backpack.

Ilyra said the presence below knew the party had the key. The [[Thirteen Tones|count]] reached three.`
	},
	{
		path: 'Events/Fourth-Tone.md',
		type: 'event',
		eventKey: 'fourth-tone',
		afterEventKey: 'third-tone',
		content: `# Fourth Tone

As the party and [[Ilyra Vey]] escaped from the [[Blackwater Cistern]], another bell sounded behind them. They could not tell whether it came from [[Edric's Brass Bell]] or the [[Cistern Bell]].

The [[Thirteen Tones|count]] is now four.`
	}
]
