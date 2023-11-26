export const ValidateConfig = async (cfg) => {
  let problems = false;
  cfg.domain.length === 0 && console.log(`Domain name is empty`) && (problems = true);
  (cfg.domain.length > 0 && !/[\w\d-]+\.[\w\d]+/.test(cfg.domain)) && console.log(`Wrong domain name: ${cfg.domain}`) && (problems = true);
  // tutaj jedziemy pozniej... 
  // dlaczego nie dziala async?
  problems && process.exit(1);
}
