export const ValidateConfig = async (cfg, issues = []) => {

  // prosty regex, byle by sprawdzic czy wartosc przypomina adres email. 
  // ostatecznie przy odpytywaniu API i tak wyjdzie czy dane autoryzacji sa prawidlowe czy nie
  !/.{1,}@.{2,}/.test(cfg.email) && issues.push(`Email address is not valid`);

  // nie wiem czy domeny w ogole nie usunac z configu
  cfg.domain.length === 0 && console.log(`Domain name is empty`) && issues.push(`Domain name is empty`);
  (cfg.domain.length > 0 && !/[\w\d-]+\.[\w\d]+/.test(cfg.domain)) && issues.push(`Domain name is not valid (${cfg.domain})`);

  // sprawdzamy czy uzytkownik wybral chociaz jedna subdomene
  Object.keys(cfg.subdomains).length === 0 && issues.push(`You have to specify at least one subdomain to use`);

  // sprawdzamy czy uzytkownik podal klucz/token API
  cfg.key.length === 0 && issues.push(`You have to set API key`);

  // sprawdzamy czy uzytkownik podal Zone ID.
  cfg.zoneId.length === 0 && issues.push(`You have to specify Zone ID`);

  // sprawdzamy czy uzytkownik w ogole podal keyType, ale nie dodajemy do issues
  cfg.keyType.length === 0 && console.log(`You haven't set the API key type. The key will be treated as a Global API key.`);

  // sprawdzamy czy uzytkownik podal prawidlowy typ klucza API.
  (cfg.keyType.length > 0 && !/^(token|key)$/.test(cfg.keyType)) && issues.push(`Invalid API key type. Choose between 'token' and 'key'.`);

  if (issues.length > 0) {
    console.log(`Found ${issues.length} issue${issues.length > 1 ? 's' : ''}`);
    issues.forEach(issue => console.log(issue));
    return true;
  } else {
    return false;
  }

}
