import { CHARACTERS } from './assets-v2.js';

export function mountCharacterPicker(backyard,coop){
  const dialog=document.getElementById('character-dialog');
  const pickers=[...document.querySelectorAll('[data-character-picker]')];
  const preview={sergey:'assets/art/common/hero_wide.webp',alex:'assets/art/common/alex_portrait.webp'};
  const sync=()=>{
    for(const picker of pickers){
      const character=picker.querySelector('select[data-character]'),costume=picker.querySelector('[data-costume]'),name=picker.querySelector('[data-player-name]'),image=picker.querySelector('img');
      character.value=backyard.characterId;
      const options=CHARACTERS[backyard.characterId].costumes;
      if(costume.dataset.forCharacter!==backyard.characterId){costume.replaceChildren(...Object.entries(options).map(([id,label])=>new Option(label,id)));costume.dataset.forCharacter=backyard.characterId;}
      costume.value=backyard.costume;name.value=backyard.playerName;
      if(image.dataset.previewCharacter!==backyard.characterId){image.src=preview[backyard.characterId];image.alt=`${CHARACTERS[backyard.characterId].name} character preview`;image.dataset.previewCharacter=backyard.characterId;}
    }
    const old=document.getElementById('sergey-costume');
    if(old.dataset.forCharacter!==backyard.characterId){old.replaceChildren(...Object.entries(CHARACTERS[backyard.characterId].costumes).map(([id,label])=>new Option(label,id)));old.dataset.forCharacter=backyard.characterId;}
    old.value=backyard.costume;document.getElementById('player-character').value=backyard.characterId;
    coop.setLocalProfile({name:backyard.playerName,character:backyard.characterId,costume:backyard.costume,axe:backyard.axe});
  };
  async function change(fn){
    for(const picker of pickers)picker.setAttribute('aria-busy','true');
    try{await fn();}catch{document.getElementById('character-message').textContent='Character could not load. Please try again.';}
    finally{for(const picker of pickers)picker.removeAttribute('aria-busy');sync();}
  }
  for(const picker of pickers){
    picker.querySelector('select[data-character]').onchange=e=>change(()=>backyard.setCharacter(e.target.value));
    picker.querySelector('[data-costume]').onchange=e=>change(()=>backyard.setCostume(e.target.value));
    picker.querySelector('[data-player-name]').oninput=e=>{
      backyard.playerName=e.target.value.replace(/[^\p{L}\p{N} _.'-]/gu,'').slice(0,16);backyard.save();
      coop.setLocalProfile({name:backyard.playerName||CHARACTERS[backyard.characterId].name});
    };
    picker.querySelector('[data-player-name]').onchange=()=>{backyard.playerName=backyard.playerName.trim()||CHARACTERS[backyard.characterId].name;backyard.save();sync();};
  }
  document.getElementById('character-button').onclick=()=>{sync();backyard.keys.clear();dialog.showModal();};
  document.getElementById('character-done').onclick=()=>dialog.close();
  document.getElementById('player-character').onchange=e=>change(()=>backyard.setCharacter(e.target.value));
  backyard.onProfile=sync;sync();
}
