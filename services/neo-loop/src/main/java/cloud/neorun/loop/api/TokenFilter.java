package cloud.neorun.loop.api;

import java.io.IOException;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import cloud.neorun.loop.config.LoopProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@Component
@Order(1)
public class TokenFilter extends OncePerRequestFilter {
  private final LoopProperties properties;

  public TokenFilter(LoopProperties properties) {
    this.properties = properties;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    String path = request.getRequestURI();
    return path.equals("/health") || path.startsWith("/internal/tools/");
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String header = request.getHeader("Authorization");
    String presented = "";
    if (header != null && header.regionMatches(true, 0, "Bearer ", 0, 7)) {
      presented = header.substring(7).trim();
    }
    if (presented.isEmpty()) {
      presented = request.getParameter("token");
    }
    if (!properties.tokenMatches(presented)) {
      response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "invalid neo-loop token");
      return;
    }
    filterChain.doFilter(request, response);
  }
}
