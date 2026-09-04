package cloud.neorun.loop.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {"neo.loop.engine=react", "neo.loop.token="})
@AutoConfigureMockMvc
class HealthControllerTest {
  @Autowired private MockMvc mvc;

  @Test
  void healthIsOpen() throws Exception {
    mvc.perform(get("/health")).andExpect(status().isOk()).andExpect(jsonPath("$.ok").value(true));
  }
}
